package main

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lmittmann/tint"
	"github.com/zul/mtunnel/agents/tunnel/internal/config"
)

func TestDefaultHostnameUsesLocalhost(t *testing.T) {
	cmd := newRootCmd()
	flag := cmd.PersistentFlags().Lookup("hostname")
	if flag == nil {
		t.Fatal("hostname flag missing")
	}
	if flag.DefValue != "localhost" {
		t.Fatalf("hostname default = %q, want localhost", flag.DefValue)
	}
}

func TestResolveHTTPConfiguredTunnel(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, config.ProjectFilename), []byte(`{"tunnels":{"api":{"port":3000,"hostname":"127.0.0.1"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	previousDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(directory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previousDirectory) })
	port, name, hostname, err := resolveHTTPTarget("api")
	if err != nil {
		t.Fatal(err)
	}
	if port != 3000 || name != "api" || hostname != "127.0.0.1" {
		t.Fatalf("resolved target = (%d, %q, %q)", port, name, hostname)
	}
}

func TestResolveHTTPInvalidNumericPortDoesNotUseProjectConfig(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, config.ProjectFilename), []byte(`{"tunnels":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	previousDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(directory); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previousDirectory) })
	_, _, _, err = resolveHTTPTarget("70000")
	if err == nil || !strings.Contains(err.Error(), "valid TCP port") {
		t.Fatalf("resolveHTTPTarget() error = %v", err)
	}
}

func TestExplicitTokenDisablesStoredRefreshToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(path, config.Config{
		Server:       "https://example.test",
		AccessToken:  "stored-access",
		RefreshToken: "stored-refresh",
	}); err != nil {
		t.Fatal(err)
	}
	o := rootOptions{config: path, token: "explicit-access"}
	cfg, err := o.loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AccessToken != "explicit-access" || cfg.RefreshToken != "" {
		t.Fatalf("explicit token did not replace stored credentials")
	}
}

func TestCommandName(t *testing.T) {
	if name := newRootCmd().Name(); name != "mt" {
		t.Fatalf("command name = %q, want mt", name)
	}
}

func TestMissingArgumentsShowsCommandHelp(t *testing.T) {
	cmd := newRootCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"http"})
	err := cmd.Execute()
	if err == nil || err.Error() != "accepts 1 arg(s), received 0" {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(output.String(), "Usage:\n  mt http <port|name> [flags]") {
		t.Fatalf("output missing command help: %q", output.String())
	}
}

func TestHTTPStatusColors(t *testing.T) {
	tests := []struct {
		status string
		color  string
	}{
		{status: "200 OK", color: "\x1b[2;94mstatus="},
		{status: "404 Not Found", color: "\x1b[2;92mstatus="},
		{status: "500 Internal Server Error", color: "\x1b[2;91mstatus="},
	}
	for _, test := range tests {
		t.Run(test.status, func(t *testing.T) {
			var output bytes.Buffer
			logger := slog.New(tint.NewHandler(&output, &tint.Options{NoColor: false, ReplaceAttr: colorHTTPStatus}))
			logger.Info("request", "status", test.status)
			if !strings.Contains(output.String(), test.color) {
				t.Fatalf("output missing color %q: %q", test.color, output.String())
			}
		})
	}
}
