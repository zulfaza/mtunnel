// Package client owns the persistent websocket, handshake, heartbeat and reconnection loop.
package client

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/zul/mtunnel/agents/tunnel/internal/auth"
	"github.com/zul/mtunnel/agents/tunnel/internal/protocol"
)

var ErrReplaced = errors.New("tunnel connection replaced by another agent")
var ErrLimitReached = errors.New("tunnel usage limit reached")

type SendFunc func(protocol.Message) error
type OpenFunc func(context.Context, protocol.HelloAck, SendFunc) func()
type MessageFunc func(protocol.Message)

type Options struct {
	Server         string
	Secret         string
	RefreshToken   string
	OnCredentials  func(auth.Credentials) error
	TunnelID       string
	AgentVersion   string
	HTTPClient     *http.Client
	Logger         *slog.Logger
	InitialBackoff time.Duration
	OnOpen         OpenFunc
	OnMessage      MessageFunc
}

func Run(ctx context.Context, opts Options) error {
	if opts.HTTPClient == nil {
		opts.HTTPClient = http.DefaultClient
	}
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.InitialBackoff <= 0 {
		opts.InitialBackoff = 500 * time.Millisecond
	}
	first := true
	delay := opts.InitialBackoff
	for {
		if ctx.Err() != nil {
			return nil
		}
		if opts.RefreshToken != "" {
			credentials, refreshErr := auth.Refresh(ctx, opts.HTTPClient, opts.Server, opts.RefreshToken)
			if refreshErr != nil {
				return refreshErr
			}
			opts.Secret, opts.RefreshToken = credentials.AccessToken, credentials.RefreshToken
			if opts.OnCredentials != nil {
				if saveErr := opts.OnCredentials(credentials); saveErr != nil {
					return saveErr
				}
			}
		}
		ack, err := runOnce(ctx, opts)
		if errors.Is(err, ErrReplaced) || errors.Is(err, ErrLimitReached) {
			return err
		}
		if ctx.Err() != nil {
			return nil
		}
		if ack.PublicURL != "" {
			delay = opts.InitialBackoff
		}
		if err == nil { // a clean unexpected close is still reconnected.
			err = errors.New("websocket closed")
		}
		if first {
			opts.Logger.Warn("tunnel connection failed", "error", err)
		} else {
			opts.Logger.Warn("tunnel connection lost", "error", err)
		}
		_ = ack
		wait := jitter(delay)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}
		delay *= 2
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}
		first = false
	}
}

func runOnce(parent context.Context, opts Options) (protocol.HelloAck, error) {
	token, err := auth.MintToken(parent, opts.HTTPClient, opts.Server, opts.Secret, opts.TunnelID)
	if err != nil {
		return protocol.HelloAck{}, err
	}
	wsURL, err := connectURL(opts.Server, opts.TunnelID)
	if err != nil {
		return protocol.HelloAck{}, err
	}
	conn, _, err := websocket.Dial(parent, wsURL, &websocket.DialOptions{
		HTTPClient: opts.HTTPClient,
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		return protocol.HelloAck{}, fmt.Errorf("dial tunnel websocket: %w", err)
	}
	defer conn.CloseNow()
	conn.SetReadLimit(protocol.MaxPayloadBytes + protocol.HeaderSize + 1024)
	// Keep this session context independent from parent so graceful shutdown can
	// enqueue Cancel frames before the websocket is closed.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	outbound := make(chan protocol.Message, 64)
	writerErr := make(chan error, 1)
	go writer(ctx, conn, outbound, writerErr)
	send := func(m protocol.Message) error {
		select {
		case outbound <- m:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := send(protocol.Hello{TunnelID: opts.TunnelID, AgentVersion: opts.AgentVersion}); err != nil {
		return protocol.HelloAck{}, err
	}
	ack, err := readHelloAck(parent, conn)
	if err != nil {
		return protocol.HelloAck{}, closeError(err)
	}
	cleanup := func() {}
	if opts.OnOpen != nil {
		cleanup = opts.OnOpen(ctx, ack, send)
		if cleanup == nil {
			cleanup = func() {}
		}
	}
	defer func() { cleanup() }()
	lastPong := time.Now()
	var pongMu sync.Mutex
	heartbeatErr := make(chan error, 1)
	go heartbeat(ctx, ack, send, func() time.Time { pongMu.Lock(); defer pongMu.Unlock(); return lastPong }, heartbeatErr)
	readErr := make(chan error, 1)
	go func() {
		for {
			_, data, e := conn.Read(ctx)
			if e != nil {
				readErr <- e
				return
			}
			message, e := protocol.DecodeMessage(data)
			if e != nil {
				readErr <- e
				return
			}
			if _, ok := message.(protocol.Pong); ok {
				pongMu.Lock()
				lastPong = time.Now()
				pongMu.Unlock()
				continue
			}
			if opts.OnMessage != nil {
				opts.OnMessage(message)
			}
		}
	}()
	select {
	case err := <-readErr:
		return ack, closeError(err)
	case err := <-writerErr:
		return ack, err
	case err := <-heartbeatErr:
		return ack, err
	case <-parent.Done():
		cleanup()
		cleanup = func() {}
		_ = conn.Close(websocket.StatusNormalClosure, "shutting down")
		return ack, nil
	}
}

func writer(ctx context.Context, conn *websocket.Conn, outbound <-chan protocol.Message, result chan<- error) {
	for {
		select {
		case <-ctx.Done():
			return
		case message := <-outbound:
			data, err := protocol.EncodeMessage(message)
			if err == nil {
				err = conn.Write(ctx, websocket.MessageBinary, data)
			}
			if err != nil {
				result <- err
				return
			}
		}
	}
}

func readHelloAck(ctx context.Context, conn *websocket.Conn) (protocol.HelloAck, error) {
	_, data, err := conn.Read(ctx)
	if err != nil {
		return protocol.HelloAck{}, err
	}
	message, err := protocol.DecodeMessage(data)
	if err != nil {
		return protocol.HelloAck{}, err
	}
	ack, ok := message.(protocol.HelloAck)
	if !ok {
		return protocol.HelloAck{}, fmt.Errorf("expected HelloAck, got %T", message)
	}
	return ack, nil
}

func heartbeat(ctx context.Context, ack protocol.HelloAck, send SendFunc, lastPong func() time.Time, result chan<- error) {
	interval := time.Duration(ack.HeartbeatIntervalMs) * time.Millisecond
	timeout := time.Duration(ack.HeartbeatTimeoutMs) * time.Millisecond
	if interval <= 0 {
		interval = 20 * time.Second
	}
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if time.Since(lastPong()) > timeout {
				result <- errors.New("heartbeat timeout")
				return
			}
			if err := send(protocol.Ping{}); err != nil {
				result <- err
				return
			}
		}
	}
}

func connectURL(server, tunnelID string) (string, error) {
	u, err := url.Parse(server)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("invalid server URL")
	}
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	case "ws", "wss":
	default:
		return "", fmt.Errorf("invalid server URL scheme")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/v1/tunnels/" + url.PathEscape(tunnelID) + "/connect"
	u.RawQuery = ""
	return u.String(), nil
}

func closeError(err error) error {
	if websocket.CloseStatus(err) == 4001 {
		return ErrReplaced
	}
	if websocket.CloseStatus(err) == 4003 {
		return ErrLimitReached
	}
	return err
}

func jitter(delay time.Duration) time.Duration {
	max := new(big.Int).SetInt64(max(1, delay.Nanoseconds()/5))
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return delay
	}
	return delay + time.Duration(n.Int64())
}
