package client

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/zul/ztunnel/agents/tunnel/internal/protocol"
)

func writeServerMessage(ctx context.Context, conn *websocket.Conn, m protocol.Message) error {
	b, err := protocol.EncodeMessage(m)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageBinary, b)
}

func readServerMessage(ctx context.Context, conn *websocket.Conn) (protocol.Message, error) {
	_, b, err := conn.Read(ctx)
	if err != nil {
		return nil, err
	}
	m, err := protocol.DecodeMessage(b)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func testServer(t *testing.T, tunnel func(*websocket.Conn, *http.Request)) *httptest.Server {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Skipf("loopback listeners unavailable: %v", err)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/token" {
			_, _ = io.WriteString(w, `{"token":"test-token"}`)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("websocket Authorization = %q, want bearer token", got)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.URL.RawQuery != "" {
			t.Errorf("websocket URL unexpectedly contains query parameters: %q", r.URL.RawQuery)
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		tunnel(conn, r)
	}))
	server.Listener = listener
	server.Start()
	return server
}

func ack() protocol.HelloAck {
	return protocol.HelloAck{TunnelID: "test-tunnel", PublicURL: "https://test.example", HeartbeatIntervalMs: 20, HeartbeatTimeoutMs: 80, RequestTimeoutMs: 1000, MaxPayloadBytes: protocol.MaxPayloadBytes}
}

func runOptions(server string) Options {
	return Options{Server: server, Secret: "secret", TunnelID: "test-tunnel", AgentVersion: "test", InitialBackoff: 5 * time.Millisecond, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

func TestReconnectAfterServerClose(t *testing.T) {
	handshakes := make(chan int, 2)
	var connections atomic.Int32
	server := testServer(t, func(conn *websocket.Conn, r *http.Request) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		m, err := readServerMessage(ctx, conn)
		if err != nil || m == nil {
			return
		}
		if _, ok := m.(protocol.Hello); !ok {
			t.Error("first message was not Hello")
			return
		}
		n := int(connections.Add(1))
		handshakes <- n
		if err := writeServerMessage(ctx, conn, ack()); err != nil {
			return
		}
		if n == 1 {
			_ = conn.Close(websocket.StatusNormalClosure, "reconnect test")
			return
		}
		<-r.Context().Done()
	})
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, runOptions(server.URL)) }()
	for want := 1; want <= 2; want++ {
		select {
		case got := <-handshakes:
			if got != want {
				t.Fatalf("handshake %d = %d", want, got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("did not observe second Hello handshake")
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("client did not stop")
	}
}

func TestHeartbeatPongKeepsConnectionAlive(t *testing.T) {
	pings := make(chan struct{}, 4)
	var connections atomic.Int32
	server := testServer(t, func(conn *websocket.Conn, r *http.Request) {
		ctx := r.Context()
		m, err := readServerMessage(ctx, conn)
		if err != nil || m == nil {
			return
		}
		if _, ok := m.(protocol.Hello); !ok {
			t.Error("first message was not Hello")
			return
		}
		connections.Add(1)
		if err := writeServerMessage(ctx, conn, ack()); err != nil {
			return
		}
		for {
			m, err := readServerMessage(ctx, conn)
			if err != nil {
				return
			}
			if _, ok := m.(protocol.Ping); ok {
				select {
				case pings <- struct{}{}:
				default:
				}
				if err := writeServerMessage(ctx, conn, protocol.Pong{}); err != nil {
					return
				}
			}
		}
	})
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, runOptions(server.URL)) }()
	for range 3 {
		select {
		case <-pings:
		case <-time.After(time.Second):
			t.Fatal("did not observe heartbeat ping")
		}
	}
	if got := connections.Load(); got != 1 {
		t.Fatalf("connections = %d, want 1", got)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("client did not stop")
	}
}

func TestHeartbeatWithoutPongReconnects(t *testing.T) {
	handshakes := make(chan int, 2)
	var connections atomic.Int32
	server := testServer(t, func(conn *websocket.Conn, r *http.Request) {
		ctx := r.Context()
		m, err := readServerMessage(ctx, conn)
		if err != nil || m == nil {
			return
		}
		if _, ok := m.(protocol.Hello); !ok {
			t.Error("first message was not Hello")
			return
		}
		n := int(connections.Add(1))
		handshakes <- n
		if err := writeServerMessage(ctx, conn, ack()); err != nil {
			return
		}
		for {
			if _, err := readServerMessage(ctx, conn); err != nil {
				return
			} // Deliberately withhold Pong.
		}
	})
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, runOptions(server.URL)) }()
	for want := 1; want <= 2; want++ {
		select {
		case got := <-handshakes:
			if got != want {
				t.Fatalf("handshake %d = %d", want, got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("heartbeat timeout did not cause reconnect")
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("client did not stop")
	}
}
