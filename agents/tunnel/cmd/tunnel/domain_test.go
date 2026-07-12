package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/zulfaza/mtunnel/agents/tunnel/internal/config"
)

func TestDomainAddRefreshesExpiredAccessToken(t *testing.T) {
	t.Helper()
	var domainRequests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"access_token":  "fresh-access",
				"refresh_token": "fresh-refresh",
			})
		case "/api/v1/domains":
			domainRequests++
			if r.Header.Get("Authorization") != "Bearer fresh-access" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"hostname":"dash.dev.upsell.is","tunnelId":"dashboard","status":"pending_dns","cname":{"type":"CNAME","name":"dash.dev.upsell.is","value":"makarima.xyz"},"verification":{"type":"TXT","name":"_mtunnel.dash.dev.upsell.is","value":"mtunnel-verification=test"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{
		Server:       server.URL,
		AccessToken:  "expired-access",
		RefreshToken: "expired-refresh",
	}); err != nil {
		t.Fatal(err)
	}
	o := rootOptions{config: configPath, name: "dashboard"}
	cmd := newDomainCmd(&o)
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"add", "dash.dev.upsell.is"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if domainRequests != 2 {
		t.Fatalf("domain requests = %d, want 2", domainRequests)
	}
	saved, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.AccessToken != "fresh-access" || saved.RefreshToken != "fresh-refresh" {
		t.Fatalf("credentials not rotated")
	}
	if !bytes.Contains(output.Bytes(), []byte("TXT _mtunnel.dash.dev.upsell.is")) {
		t.Fatalf("output missing verification instructions: %q", output.String())
	}
	if !bytes.Contains(output.Bytes(), []byte("mt domain verify dashboard\n")) {
		t.Fatalf("output missing tunnel-name verify command: %q", output.String())
	}
}

func TestDecodeDomainResultAcceptsLegacyCNAME(t *testing.T) {
	result, err := decodeDomainResult([]byte(`{"hostname":"dash.dev.upsell.is","tunnelId":"dashboard","status":"pending_dns","cname":"makarima.xyz"}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.CNAME != (dnsRecord{Type: "CNAME", Name: "dash.dev.upsell.is", Value: "makarima.xyz"}) {
		t.Fatalf("unexpected CNAME: %#v", result.CNAME)
	}
	if result.Verification != (dnsRecord{}) {
		t.Fatalf("unexpected verification record: %#v", result.Verification)
	}
}

func TestDomainListAndDelete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/domains":
			w.Write([]byte(`{"domains":[{"hostname":"app.upsell.is","tunnelId":"upsell","status":"active","lastUsedAt":"2026-07-11T01:02:03Z","cname":{"type":"CNAME","name":"app.upsell.is","value":"makarima.xyz"},"verification":{"type":"TXT","name":"_mtunnel.app.upsell.is","value":"mtunnel-verification=test"}}]}`))
		case r.Method == http.MethodDelete && r.URL.Path == "/api/v1/domains/app.upsell.is":
			w.Write([]byte(`{"hostname":"app.upsell.is","tunnelId":"upsell","status":"active","lastUsedAt":"2026-07-11T01:02:03Z","cname":{"type":"CNAME","name":"app.upsell.is","value":"makarima.xyz"},"verification":{"type":"TXT","name":"_mtunnel.app.upsell.is","value":"mtunnel-verification=test"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{Server: server.URL, AccessToken: "access"}); err != nil {
		t.Fatal(err)
	}
	o := rootOptions{config: configPath}
	cmd := newDomainCmd(&o)
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"list"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte("app.upsell.is")) || !bytes.Contains(output.Bytes(), []byte("active")) || !bytes.Contains(output.Bytes(), []byte("2026-07-11")) {
		t.Fatalf("unexpected list output: %q", output.String())
	}

	output.Reset()
	cmd = newDomainCmd(&o)
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"delete", "app.upsell.is"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if output.String() != "Deleted custom domain app.upsell.is.\n" {
		t.Fatalf("unexpected delete output: %q", output.String())
	}
}

func TestDomainDeleteByTunnelName(t *testing.T) {
	var deletedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/domains":
			w.Write([]byte(`{"domains":[{"hostname":"dev.makarima.dev","tunnelId":"mdev","status":"active","cname":{"type":"CNAME","name":"dev.makarima.dev","value":"makarima.xyz"}}]}`))
		case r.Method == http.MethodDelete:
			deletedPath = r.URL.Path
			w.Write([]byte(`{"hostname":"dev.makarima.dev","tunnelId":"mdev","status":"active","cname":{"type":"CNAME","name":"dev.makarima.dev","value":"makarima.xyz"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{Server: server.URL, AccessToken: "access"}); err != nil {
		t.Fatal(err)
	}
	o := rootOptions{config: configPath}
	cmd := newDomainCmd(&o)
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"delete", "mdev"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if deletedPath != "/api/v1/domains/dev.makarima.dev" {
		t.Fatalf("deleted path = %q", deletedPath)
	}
	if output.String() != "Deleted custom domain dev.makarima.dev.\n" {
		t.Fatalf("unexpected delete output: %q", output.String())
	}
}

func TestDomainVerifyByTunnelName(t *testing.T) {
	var verifiedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/domains":
			w.Write([]byte(`{"domains":[{"hostname":"dev.makarima.dev","tunnelId":"mdev","status":"pending_dns","cname":{"type":"CNAME","name":"dev.makarima.dev","value":"cname.makarima.xyz"}}]}`))
		case r.Method == http.MethodPost:
			verifiedPath = r.URL.Path
			w.Write([]byte(`{"hostname":"dev.makarima.dev","tunnelId":"mdev","status":"active","cname":{"type":"CNAME","name":"dev.makarima.dev","value":"cname.makarima.xyz"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{Server: server.URL, AccessToken: "access"}); err != nil {
		t.Fatal(err)
	}
	o := rootOptions{config: configPath}
	cmd := newDomainCmd(&o)
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"verify", "mdev"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if verifiedPath != "/api/v1/domains/dev.makarima.dev/verify" {
		t.Fatalf("verified path = %q", verifiedPath)
	}
	if output.String() != "Domain: dev.makarima.dev\nStatus: active\n" {
		t.Fatalf("unexpected verify output: %q", output.String())
	}
}

func TestDomainVerifyAlreadyActive(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/domains":
			w.Write([]byte(`{"domains":[{"hostname":"dev.makarima.dev","tunnelId":"mdev","status":"active","cname":{"type":"CNAME","name":"dev.makarima.dev","value":"cname.makarima.xyz"}}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/domains/dev.makarima.dev/verify":
			w.Write([]byte(`{"hostname":"dev.makarima.dev","tunnelId":"mdev","status":"active","cname":{"type":"CNAME","name":"dev.makarima.dev","value":"cname.makarima.xyz"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{Server: server.URL, AccessToken: "access"}); err != nil {
		t.Fatal(err)
	}
	cmd := newDomainCmd(&rootOptions{config: configPath})
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"verify", "mdev"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if output.String() != "Domain dev.makarima.dev already verified. You can use it now.\n" {
		t.Fatalf("unexpected verify output: %q", output.String())
	}
}
