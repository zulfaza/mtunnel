package proxy

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/zul/mtunnel/agents/tunnel/internal/protocol"
)

func newTestDispatcher(t *testing.T, upstream string, timeout time.Duration) (*Dispatcher, <-chan protocol.Message, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	messages := make(chan protocol.Message, 32)
	d := New(Options{
		BaseContext: ctx,
		Upstream:    upstream,
		Timeout:     timeout,
		Send: func(m protocol.Message) error {
			messages <- m
			return nil
		},
	})
	t.Cleanup(func() { cancel(); d.Shutdown(time.Second) })
	return d, messages, cancel
}

func newHTTPServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Skipf("loopback listeners unavailable: %v", err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	return server
}

func receive(t *testing.T, messages <-chan protocol.Message) protocol.Message {
	t.Helper()
	select {
	case m := <-messages:
		return m
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for protocol message")
		return nil
	}
}

func responseFor(t *testing.T, messages <-chan protocol.Message, id protocol.RequestID) (protocol.ResponseStart, []byte) {
	t.Helper()
	var start protocol.ResponseStart
	var body bytes.Buffer
	for {
		switch m := receive(t, messages).(type) {
		case protocol.ResponseStart:
			if m.RequestID == id {
				start = m
			}
		case protocol.ResponseBody:
			if m.RequestID == id {
				body.Write(m.Data)
			}
		case protocol.ResponseEnd:
			if m.RequestID == id {
				return start, body.Bytes()
			}
		case protocol.ErrorMessage:
			t.Fatalf("unexpected ErrorMessage: %#v", m)
		}
	}
}

func TestSimpleGETRoundTrip(t *testing.T) {
	upstream := newHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RequestURI() != "/hello?x=1" {
			t.Errorf("request URI = %q", r.URL.RequestURI())
		}
		w.Header().Set("X-Upstream", "yes")
		_, _ = io.WriteString(w, "hello")
	}))
	defer upstream.Close()
	d, messages, _ := newTestDispatcher(t, upstream.URL, time.Second)
	id := protocol.NewRequestID()
	d.Start(protocol.RequestStart{RequestID: id, Method: http.MethodGet, Path: "/hello?x=1"})
	start, body := responseFor(t, messages, id)
	if start.Status != http.StatusOK || string(body) != "hello" {
		t.Fatalf("response = status %d body %q", start.Status, body)
	}
}

func TestAccessLogFormatting(t *testing.T) {
	if got := endpointPath("/hello?token=secret"); got != "/hello" {
		t.Fatalf("endpoint path = %q, want /hello", got)
	}
	if got := httpStatus(http.StatusCreated); got != "201 Created" {
		t.Fatalf("HTTP status = %q, want 201 Created", got)
	}
}

func TestStreamedRequestBody(t *testing.T) {
	want := []byte("one-two-three")
	upstream := newHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("body = %q, want %q", got, want)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer upstream.Close()
	d, messages, _ := newTestDispatcher(t, upstream.URL, time.Second)
	id := protocol.NewRequestID()
	d.Start(protocol.RequestStart{RequestID: id, Method: http.MethodPost, Path: "/", HasBody: true})
	d.Body(protocol.RequestBody{RequestID: id, Data: []byte("one-")})
	d.Body(protocol.RequestBody{RequestID: id, Data: []byte("two-")})
	d.Body(protocol.RequestBody{RequestID: id, Data: []byte("three")})
	d.End(protocol.RequestEnd{RequestID: id})
	start, _ := responseFor(t, messages, id)
	if start.Status != http.StatusCreated {
		t.Fatalf("status = %d, want %d", start.Status, http.StatusCreated)
	}
}

func TestStreamedResponseBody(t *testing.T) {
	want := bytes.Repeat([]byte("a"), 3*protocol.MaxPayloadBytes+17)
	upstream := newHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(want)
	}))
	defer upstream.Close()
	d, messages, _ := newTestDispatcher(t, upstream.URL, 5*time.Second)
	id := protocol.NewRequestID()
	d.Start(protocol.RequestStart{RequestID: id, Method: http.MethodGet, Path: "/"})
	var got bytes.Buffer
	chunks := 0
	for {
		switch m := receive(t, messages).(type) {
		case protocol.ResponseBody:
			chunks++
			if len(m.Data) > protocol.MaxPayloadBytes {
				t.Fatalf("chunk too large: %d", len(m.Data))
			}
			got.Write(m.Data)
		case protocol.ResponseEnd:
			if !bytes.Equal(got.Bytes(), want) {
				t.Fatalf("body mismatch: got %d bytes want %d", got.Len(), len(want))
			}
			if chunks < 3 {
				t.Fatalf("chunk count = %d, want at least 3", chunks)
			}
			return
		case protocol.ErrorMessage:
			t.Fatalf("unexpected error: %#v", m)
		}
	}
}

func TestDuplicateSetCookiePreserved(t *testing.T) {
	upstream := newHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Set-Cookie", "one=1")
		w.Header().Add("Set-Cookie", "two=2")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	d, messages, _ := newTestDispatcher(t, upstream.URL, time.Second)
	id := protocol.NewRequestID()
	d.Start(protocol.RequestStart{RequestID: id, Method: http.MethodGet, Path: "/"})
	start, _ := responseFor(t, messages, id)
	var cookies []string
	for _, header := range start.Headers {
		if header[0] == "Set-Cookie" {
			cookies = append(cookies, header[1])
		}
	}
	if len(cookies) != 2 || cookies[0] != "one=1" || cookies[1] != "two=2" {
		t.Fatalf("Set-Cookie headers = %#v", cookies)
	}
}

func TestCancelCancelsUpstreamRequest(t *testing.T) {
	cancelled := make(chan struct{})
	var once sync.Once
	upstream := newHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-r.Context().Done()
		once.Do(func() { close(cancelled) })
	}))
	defer upstream.Close()
	d, messages, _ := newTestDispatcher(t, upstream.URL, 5*time.Second)
	id := protocol.NewRequestID()
	d.Start(protocol.RequestStart{RequestID: id, Method: http.MethodGet, Path: "/"})
	if _, ok := receive(t, messages).(protocol.ResponseStart); !ok {
		t.Fatal("expected ResponseStart")
	}
	d.Cancel(protocol.Cancel{RequestID: id, Reason: protocol.CancelClientDisconnected})
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream context was not cancelled")
	}
}

func TestUpstreamConnectionRefusedSendsError(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("loopback listeners unavailable: %v", err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	d, messages, _ := newTestDispatcher(t, "http://"+address, time.Second)
	id := protocol.NewRequestID()
	d.Start(protocol.RequestStart{RequestID: id, Method: http.MethodGet, Path: "/"})
	m, ok := receive(t, messages).(protocol.ErrorMessage)
	if !ok || m.RequestID != id || m.Code != protocol.ErrorCodeUpstreamUnreachable {
		t.Fatalf("message = %#v", m)
	}
}

func TestUpstreamTimeoutSendsError(t *testing.T) {
	upstream := newHTTPServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	d, messages, _ := newTestDispatcher(t, upstream.URL, 25*time.Millisecond)
	id := protocol.NewRequestID()
	d.Start(protocol.RequestStart{RequestID: id, Method: http.MethodGet, Path: "/"})
	m, ok := receive(t, messages).(protocol.ErrorMessage)
	if !ok || m.RequestID != id || m.Code != protocol.ErrorCodeUpstreamUnreachable {
		t.Fatalf("message = %#v", m)
	}
}
