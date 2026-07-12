// Package proxy turns server-side protocol requests into streamed local HTTP requests.
package proxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/zulfaza/mtunnel/agents/tunnel/internal/protocol"
)

type SendFunc func(protocol.Message) error

type Options struct {
	BaseContext context.Context
	Upstream    string
	Timeout     time.Duration
	TunnelID    string
	Logger      *slog.Logger
	Send        SendFunc
	HTTPClient  *http.Client
}

type Dispatcher struct {
	ctx        context.Context
	upstream   string
	timeout    time.Duration
	tunnelID   string
	logger     *slog.Logger
	send       SendFunc
	httpClient *http.Client
	mu         sync.Mutex
	requests   map[protocol.RequestID]*request
	accepting  bool
	wg         sync.WaitGroup
}

type request struct {
	start   protocol.RequestStart
	ctx     context.Context
	cancel  context.CancelFunc
	bodyCh  chan []byte
	pipeR   *io.PipeReader
	pipeW   *io.PipeWriter
	endOnce sync.Once
	bytesIn atomic.Int64
}

func New(opts Options) *Dispatcher {
	if opts.BaseContext == nil {
		opts.BaseContext = context.Background()
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 30 * time.Second
	}
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{Transport: &http.Transport{DisableCompression: true, Proxy: http.ProxyFromEnvironment}}
	}
	return &Dispatcher{ctx: opts.BaseContext, upstream: strings.TrimRight(opts.Upstream, "/"), timeout: opts.Timeout, tunnelID: opts.TunnelID, logger: opts.Logger, send: opts.Send, httpClient: opts.HTTPClient, requests: make(map[protocol.RequestID]*request), accepting: true}
}

func (d *Dispatcher) Start(m protocol.RequestStart) {
	d.mu.Lock()
	if !d.accepting {
		d.mu.Unlock()
		_ = d.send(protocol.Cancel{RequestID: m.RequestID, Reason: protocol.CancelShutdown})
		return
	}
	if _, exists := d.requests[m.RequestID]; exists {
		d.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(d.ctx, d.timeout)
	r := &request{start: m, ctx: ctx, cancel: cancel}
	if m.HasBody {
		r.bodyCh = make(chan []byte, 8)
		r.pipeR, r.pipeW = io.Pipe()
		go r.feedBody()
	}
	d.requests[m.RequestID] = r
	d.wg.Add(1)
	d.mu.Unlock()
	go d.run(m.RequestID, r)
}

func (r *request) feedBody() {
	defer r.pipeW.Close()
	for data := range r.bodyCh {
		if _, err := r.pipeW.Write(data); err != nil {
			return
		}
	}
}

func (r *request) closeBody() {
	if r.pipeR != nil {
		_ = r.pipeR.CloseWithError(context.Canceled)
	}
}

func (d *Dispatcher) Body(m protocol.RequestBody) {
	d.mu.Lock()
	r := d.requests[m.RequestID]
	d.mu.Unlock()
	if r == nil || r.bodyCh == nil {
		return
	}
	data := append([]byte(nil), m.Data...)
	r.bytesIn.Add(int64(len(data)))
	select {
	case r.bodyCh <- data:
	case <-r.ctx.Done():
	}
}

func (d *Dispatcher) End(m protocol.RequestEnd) {
	d.mu.Lock()
	r := d.requests[m.RequestID]
	d.mu.Unlock()
	if r != nil && r.bodyCh != nil {
		r.endOnce.Do(func() { close(r.bodyCh) })
	}
}

func (d *Dispatcher) Cancel(m protocol.Cancel) {
	d.mu.Lock()
	r := d.requests[m.RequestID]
	d.mu.Unlock()
	if r != nil {
		r.cancel()
		r.closeBody()
	}
}

func (d *Dispatcher) run(id protocol.RequestID, r *request) {
	defer d.wg.Done()
	defer r.cancel()
	defer r.closeBody()
	defer func() { d.mu.Lock(); delete(d.requests, id); d.mu.Unlock() }()
	started := time.Now()
	var out int64
	var body io.Reader
	if r.pipeR != nil {
		body = r.pipeR
	}
	req, err := http.NewRequestWithContext(r.ctx, r.start.Method, d.upstream+r.start.Path, body)
	if err != nil {
		d.sendFailure(id, r, started, out, err)
		return
	}
	for _, h := range r.start.Headers {
		req.Header.Add(h[0], h[1])
	}
	resp, err := d.httpClient.Do(req)
	if err != nil {
		d.sendFailure(id, r, started, out, err)
		return
	}
	defer resp.Body.Close()
	headers := make(protocol.HeaderPairs, 0)
	for key, values := range resp.Header {
		for _, value := range values {
			headers = append(headers, [2]string{key, value})
		}
	}
	hasBody := resp.Body != nil && r.start.Method != http.MethodHead && resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotModified
	if err := d.send(protocol.ResponseStart{RequestID: id, Status: resp.StatusCode, Headers: headers, HasBody: hasBody}); err != nil {
		return
	}
	if hasBody {
		buf := make([]byte, protocol.MaxPayloadBytes)
		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				out += int64(n)
				if err := d.send(protocol.ResponseBody{RequestID: id, Data: append([]byte(nil), buf[:n]...)}); err != nil {
					return
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				break
			}
		}
	}
	_ = d.send(protocol.ResponseEnd{RequestID: id})
	duration := time.Since(started)
	path := endpointPath(r.start.Path)
	d.logger.Info(r.start.Method+" "+path, "status", httpStatus(resp.StatusCode), "duration", duration)
	d.logger.Debug("request details", "event", "request_complete", "tunnelId", d.tunnelID, "requestId", protocol.RequestIDHex(id), "method", r.start.Method, "path", path, "status", resp.StatusCode, "duration", duration, "bytesIn", r.bytesIn.Load(), "bytesOut", out)
}

func (d *Dispatcher) sendFailure(id protocol.RequestID, r *request, started time.Time, out int64, err error) {
	message := "upstream unavailable"
	if errors.Is(err, context.DeadlineExceeded) {
		message = "upstream request timed out"
	}
	_ = d.send(protocol.ErrorMessage{RequestID: id, Code: protocol.ErrorCodeUpstreamUnreachable, Message: message})
	duration := time.Since(started)
	path := endpointPath(r.start.Path)
	d.logger.Warn(r.start.Method+" "+path, "status", httpStatus(http.StatusBadGateway), "duration", duration, "error", fmt.Sprint(err))
	d.logger.Debug("request details", "event", "request_failed", "tunnelId", d.tunnelID, "requestId", protocol.RequestIDHex(id), "method", r.start.Method, "path", path, "status", http.StatusBadGateway, "duration", duration, "bytesIn", r.bytesIn.Load(), "bytesOut", out)
}

func endpointPath(value string) string {
	path, _, _ := strings.Cut(value, "?")
	return path
}

func httpStatus(code int) string {
	text := http.StatusText(code)
	if text == "" {
		return fmt.Sprint(code)
	}
	return fmt.Sprintf("%d %s", code, text)
}

// Shutdown prevents new requests, cancels existing work, and waits at most wait.
func (d *Dispatcher) Shutdown(wait time.Duration) {
	d.mu.Lock()
	d.accepting = false
	active := make([]protocol.RequestID, 0, len(d.requests))
	for id, r := range d.requests {
		active = append(active, id)
		r.cancel()
		r.closeBody()
	}
	d.mu.Unlock()
	for _, id := range active {
		_ = d.send(protocol.Cancel{RequestID: id, Reason: protocol.CancelShutdown})
	}
	done := make(chan struct{})
	go func() { d.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(wait):
	}
}
