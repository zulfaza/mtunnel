package auth

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWaitForDeviceLoginStopsWhenAccessIsDenied(t *testing.T) {
	server := newServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "access_denied"})
	}))
	defer server.Close()

	_, err := WaitForDeviceLogin(context.Background(), server.Client(), server.URL, DeviceAuthorization{
		DeviceCode: "device-code",
		ExpiresIn:  5,
	})
	if err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("error = %v, want login denied", err)
	}
}

func newServer(t *testing.T, handler http.Handler) *httptest.Server {
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

func TestMintToken(t *testing.T) {
	server := newServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/token" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authorization not sent")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"minted"}`))
	}))
	defer server.Close()
	got, err := MintToken(context.Background(), server.Client(), server.URL, "secret", "my-tunnel", "")
	if err != nil {
		t.Fatal(err)
	}
	if got != "minted" {
		t.Fatalf("token = %q", got)
	}
}

func TestMintTokenOrganizationHeader(t *testing.T) {
	server := newServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Organization-Id") != "org_123" {
			t.Errorf("organization header = %q", r.Header.Get("X-Organization-Id"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"minted"}`))
	}))
	defer server.Close()
	if _, err := MintToken(context.Background(), server.Client(), server.URL, "secret", "my-tunnel", "org_123"); err != nil {
		t.Fatal(err)
	}
}

func TestMintTokenUnauthorized(t *testing.T) {
	server := newServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer server.Close()
	_, err := MintToken(context.Background(), server.Client(), server.URL, "secret", "my-tunnel", "")
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("error = %v, want descriptive 401 error", err)
	}
}
