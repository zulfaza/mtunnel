package config

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingFilePreservesNotExist(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "missing.json"))
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("Load() error = %v, want fs.ErrNotExist", err)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.json")
	want := Config{Server: "https://example.test", Secret: "secret"}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("Load() = %#v, want %#v", got, want)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode = %o, want 600", got)
	}
}

func TestLoadProjectSearchesParentDirectories(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ProjectFilename)
	contents := []byte(`{"tunnels":{"api":{"port":3000,"hostname":"127.0.0.1"}}}`)
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(root, "services", "api")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	projectConfig, gotPath, err := LoadProject(nested)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != path {
		t.Fatalf("path = %q, want %q", gotPath, path)
	}
	if got := projectConfig.Tunnels["api"]; got.Port != 3000 || got.Hostname != "127.0.0.1" {
		t.Fatalf("tunnel = %#v", got)
	}
}

func TestLoadProjectMissingFilePreservesNotExist(t *testing.T) {
	_, _, err := LoadProject(t.TempDir())
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("LoadProject() error = %v, want fs.ErrNotExist", err)
	}
}

func TestSaveCredentialsKeepsOtherFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	stored := Config{Server: "https://example.test", AccessToken: "old-access", RefreshToken: "old-refresh", OrganizationID: "org_1"}
	if err := SaveCredentials(path, stored, "new-access", "new-refresh"); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	want := Config{Server: "https://example.test", AccessToken: "new-access", RefreshToken: "new-refresh", OrganizationID: "org_1"}
	if got != want {
		t.Fatalf("Load() = %#v, want %#v", got, want)
	}
}

func TestLatestRefreshTokenPrefersStoredValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := Save(path, Config{Server: "https://example.test", RefreshToken: "rotated-refresh"}); err != nil {
		t.Fatal(err)
	}
	if got := LatestRefreshToken(path, "captured-refresh"); got != "rotated-refresh" {
		t.Fatalf("LatestRefreshToken() = %q, want rotated-refresh", got)
	}
	missing := filepath.Join(t.TempDir(), "missing.json")
	if got := LatestRefreshToken(missing, "captured-refresh"); got != "captured-refresh" {
		t.Fatalf("LatestRefreshToken() = %q, want the captured fallback", got)
	}
}

func TestSaveLeavesNoTemporaryFiles(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "config.json")
	if err := Save(path, Config{Server: "https://example.test"}); err != nil {
		t.Fatal(err)
	}
	if err := Save(path, Config{Server: "https://example.test", AccessToken: "second"}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "config.json" {
		t.Fatalf("directory entries = %v, want only config.json", entries)
	}
}
