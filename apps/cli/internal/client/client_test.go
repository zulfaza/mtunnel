package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/zulfaza/mtunnel/apps/cli/internal/auth"
	"github.com/zulfaza/mtunnel/apps/cli/internal/protocol"
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

func readServerText(ctx context.Context, conn *websocket.Conn) (string, error) {
	messageType, data, err := conn.Read(ctx)
	if err != nil {
		return "", err
	}
	if messageType != websocket.MessageText {
		return "", io.ErrUnexpectedEOF
	}
	return string(data), nil
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
		if r.URL.Path == "/api/v1/auth/refresh" {
			t.Error("unexpected token refresh")
			http.Error(w, "unexpected token refresh", http.StatusInternalServerError)
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

func TestValidAccessTokenIsNotRefreshed(t *testing.T) {
	connected := make(chan struct{}, 1)
	server := testServer(t, func(conn *websocket.Conn, request *http.Request) {
		ctx := request.Context()
		if _, err := readServerMessage(ctx, conn); err != nil {
			return
		}
		if err := writeServerMessage(ctx, conn, ack()); err != nil {
			return
		}
		connected <- struct{}{}
		<-ctx.Done()
	})
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	opts := runOptions(server.URL)
	opts.RefreshToken = "unused-refresh"
	done := make(chan error, 1)
	go func() { done <- Run(ctx, opts) }()
	select {
	case <-connected:
		cancel()
	case <-ctx.Done():
		t.Fatal("client did not connect")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestUnauthorizedAccessTokenIsRefreshed(t *testing.T) {
	connected := make(chan struct{}, 1)
	saved := make(chan auth.Credentials, 1)
	var tokenRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/token":
			tokenRequests.Add(1)
			if r.Header.Get("Authorization") != "Bearer fresh-access" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"token":"agent-token"}`)
		case "/api/v1/auth/refresh":
			_, _ = io.WriteString(w, `{"access_token":"fresh-access","refresh_token":"fresh-refresh"}`)
		default:
			if r.Header.Get("Authorization") != "Bearer agent-token" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer conn.CloseNow()
			ctx := r.Context()
			if _, err := readServerMessage(ctx, conn); err != nil {
				return
			}
			if err := writeServerMessage(ctx, conn, ack()); err != nil {
				return
			}
			connected <- struct{}{}
			<-ctx.Done()
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	opts := runOptions(server.URL)
	opts.Secret = "expired-access"
	opts.RefreshToken = "old-refresh"
	opts.OnCredentials = func(credentials auth.Credentials) error {
		saved <- credentials
		return nil
	}
	done := make(chan error, 1)
	go func() { done <- Run(ctx, opts) }()
	select {
	case <-connected:
		cancel()
	case <-ctx.Done():
		t.Fatal("client did not connect after refresh")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if tokenRequests.Load() != 2 {
		t.Fatalf("token requests = %d, want 2", tokenRequests.Load())
	}
	select {
	case credentials := <-saved:
		if credentials.AccessToken != "fresh-access" || credentials.RefreshToken != "fresh-refresh" {
			t.Fatalf("saved credentials = %#v", credentials)
		}
	default:
		t.Fatal("rotated credentials not saved")
	}
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
		for {
			if _, _, err := conn.Read(r.Context()); err != nil {
				return
			}
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
			message, err := readServerText(ctx, conn)
			if err != nil {
				return
			}
			if message == "ping" {
				select {
				case pings <- struct{}{}:
				default:
				}
				if err := conn.Write(ctx, websocket.MessageText, []byte("pong")); err != nil {
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
			if _, err := readServerText(ctx, conn); err != nil {
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

// refreshServer answers /api/v1/auth/token with a per-access-token agent token,
// accepts the websocket only for the agent token minted from "fresh-access", and
// delegates /api/v1/auth/refresh to the supplied handler.
func refreshServer(t *testing.T, refresh http.HandlerFunc, connected chan<- struct{}) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/token":
			if r.Header.Get("Authorization") == "Bearer fresh-access" {
				_, _ = io.WriteString(w, `{"token":"fresh-agent-token"}`)
				return
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		case "/api/v1/auth/refresh":
			refresh(w, r)
		default:
			if r.Header.Get("Authorization") != "Bearer fresh-agent-token" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer conn.CloseNow()
			ctx := r.Context()
			if _, err := readServerMessage(ctx, conn); err != nil {
				return
			}
			if err := writeServerMessage(ctx, conn, ack()); err != nil {
				return
			}
			connected <- struct{}{}
			<-ctx.Done()
		}
	}))
}

func TestRejectedRefreshTokenStopsWithLoginHint(t *testing.T) {
	server := refreshServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
	}, make(chan struct{}, 1))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	opts := runOptions(server.URL)
	opts.Secret = "expired-access"
	opts.RefreshToken = "revoked-refresh"
	if err := Run(ctx, opts); !errors.Is(err, ErrSessionExpired) {
		t.Fatalf("Run() error = %v, want %v", err, ErrSessionExpired)
	}
}

func TestTransientRefreshFailureRetriesInsteadOfExiting(t *testing.T) {
	connected := make(chan struct{}, 1)
	var refreshes atomic.Int32
	server := refreshServer(t, func(w http.ResponseWriter, r *http.Request) {
		if refreshes.Add(1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = io.WriteString(w, `{"access_token":"fresh-access","refresh_token":"fresh-refresh"}`)
	}, connected)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	opts := runOptions(server.URL)
	opts.Secret = "expired-access"
	opts.RefreshToken = "old-refresh"
	done := make(chan error, 1)
	go func() { done <- Run(ctx, opts) }()
	select {
	case <-connected:
		cancel()
	case err := <-done:
		t.Fatalf("Run() returned %v instead of retrying the refresh", err)
	case <-ctx.Done():
		t.Fatal("client did not connect after a transient refresh failure")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got := refreshes.Load(); got != 2 {
		t.Fatalf("refresh attempts = %d, want 2", got)
	}
}

func TestRefreshUsesRotatedTokenFromDisk(t *testing.T) {
	connected := make(chan struct{}, 1)
	presented := make(chan string, 4)
	server := refreshServer(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RefreshToken string `json:"refreshToken"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		presented <- body.RefreshToken
		if body.RefreshToken != "rotated-refresh" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, `{"access_token":"fresh-access","refresh_token":"next-refresh"}`)
	}, connected)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	opts := runOptions(server.URL)
	opts.Secret = "expired-access"
	opts.RefreshToken = "superseded-refresh"
	opts.LatestRefreshToken = func() string { return "rotated-refresh" }
	done := make(chan error, 1)
	go func() { done <- Run(ctx, opts) }()
	select {
	case <-connected:
		cancel()
	case err := <-done:
		t.Fatalf("Run() returned %v", err)
	case <-ctx.Done():
		t.Fatal("client did not connect with the rotated refresh token")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got := <-presented; got != "rotated-refresh" {
		t.Fatalf("presented refresh token = %q, want the rotated one from disk", got)
	}
}

func TestUnauthorizedWebsocketDialTriggersRefresh(t *testing.T) {
	connected := make(chan struct{}, 1)
	var refreshed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/token":
			if r.Header.Get("Authorization") == "Bearer fresh-access" {
				_, _ = io.WriteString(w, `{"token":"fresh-agent-token"}`)
				return
			}
			// The access token still mints an agent token; only the tunnel rejects it.
			_, _ = io.WriteString(w, `{"token":"stale-agent-token"}`)
		case "/api/v1/auth/refresh":
			refreshed.Store(true)
			_, _ = io.WriteString(w, `{"access_token":"fresh-access","refresh_token":"fresh-refresh"}`)
		default:
			if r.Header.Get("Authorization") != "Bearer fresh-agent-token" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer conn.CloseNow()
			ctx := r.Context()
			if _, err := readServerMessage(ctx, conn); err != nil {
				return
			}
			if err := writeServerMessage(ctx, conn, ack()); err != nil {
				return
			}
			connected <- struct{}{}
			<-ctx.Done()
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	opts := runOptions(server.URL)
	opts.Secret = "expired-access"
	opts.RefreshToken = "old-refresh"
	done := make(chan error, 1)
	go func() { done <- Run(ctx, opts) }()
	select {
	case <-connected:
		cancel()
	case err := <-done:
		t.Fatalf("Run() returned %v", err)
	case <-ctx.Done():
		t.Fatal("client did not reconnect after an unauthorized websocket dial")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !refreshed.Load() {
		t.Fatal("unauthorized websocket dial did not trigger a token refresh")
	}
}
