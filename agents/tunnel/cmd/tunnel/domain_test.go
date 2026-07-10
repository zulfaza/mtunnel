package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/zul/mtunnel/agents/tunnel/internal/config"
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
