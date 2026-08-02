package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zulfaza/mtunnel/apps/cli/internal/config"
)

func TestPreviewPathUsesParentCommand(t *testing.T) {
	command := newPreviewCmd(&rootOptions{})
	command.SetOut(io.Discard)
	command.SetErr(io.Discard)
	command.SetArgs([]string{"/missing-preview-file"})
	err := command.Execute()
	if err == nil || !strings.Contains(err.Error(), "build preview") {
		t.Fatalf("path did not invoke upload: %v", err)
	}
}

func TestPreviewOutputURLUsesFilePathForSingleFile(t *testing.T) {
	output, err := previewOutputURL("https://preview.makarima.xyz/id/", []previewFile{{Path: "demo video.mov"}})
	if err != nil {
		t.Fatal(err)
	}
	if output != "https://preview.makarima.xyz/id/demo%20video.mov" {
		t.Fatalf("output = %q", output)
	}
}

func TestBuildPreviewManifestDirectory(t *testing.T) {
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("<h1>Hello</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "assets", "app.js"), []byte("console.log('hello')"), 0o644); err != nil {
		t.Fatal(err)
	}
	name, files, err := buildPreviewManifest(directory)
	if err != nil {
		t.Fatal(err)
	}
	if name != filepath.Base(directory) || len(files) != 2 {
		t.Fatalf("unexpected manifest: %q %#v", name, files)
	}
	if files[0].Path != "assets/app.js" || files[1].Path != "index.html" {
		t.Fatalf("unexpected paths: %#v", files)
	}
	for _, file := range files {
		if len(file.SHA256) != 64 || file.ContentType == "" {
			t.Fatalf("invalid file metadata: %#v", file)
		}
	}
}

func previewCreateServer(t *testing.T, createBody *map[string]any) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/previews":
			if err := json.NewDecoder(r.Body).Decode(createBody); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"id":"pv1","name":"index.html","url":"https://preview.makarima.xyz/pv1/","totalBytes":14,"fileCount":1,"createdAt":1,"expiresAt":2,"visibility":"code"}`))
		case r.Method == http.MethodPut:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func previewTestConfig(t *testing.T, serverURL string) string {
	t.Helper()
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{Server: serverURL, AccessToken: "access"}); err != nil {
		t.Fatal(err)
	}
	return configPath
}

func TestPreviewCreateSendsVisibilityAndAccessCode(t *testing.T) {
	var createBody map[string]any
	server := previewCreateServer(t, &createBody)
	directory := t.TempDir()
	page := filepath.Join(directory, "index.html")
	if err := os.WriteFile(page, []byte("<h1>Hello</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	configPath := previewTestConfig(t, server.URL)
	cmd := newPreviewCmd(&rootOptions{config: configPath})
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{page, "--visibility", "code", "--code", "letmein-secure"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if createBody["visibility"] != "code" || createBody["accessCode"] != "letmein-secure" {
		t.Fatalf("unexpected create body: %#v", createBody)
	}
	if !strings.Contains(output.String(), "https://preview.makarima.xyz/pv1/index.html") {
		t.Fatalf("unexpected output: %q", output.String())
	}
}

func TestPreviewCreateOmitsVisibilityForPublic(t *testing.T) {
	var createBody map[string]any
	server := previewCreateServer(t, &createBody)
	directory := t.TempDir()
	page := filepath.Join(directory, "index.html")
	if err := os.WriteFile(page, []byte("<h1>Hello</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	configPath := previewTestConfig(t, server.URL)
	cmd := newPreviewCmd(&rootOptions{config: configPath})
	cmd.SetOut(io.Discard)
	cmd.SetArgs([]string{page})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if _, present := createBody["visibility"]; present {
		t.Fatalf("visibility should be omitted: %#v", createBody)
	}
	if _, present := createBody["accessCode"]; present {
		t.Fatalf("accessCode should be omitted: %#v", createBody)
	}
}

func TestPreviewVisibilityFlagValidation(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"code without access code", []string{"index.html", "--visibility", "code"}, "--code is required"},
		{"access code with public", []string{"index.html", "--code", "letmein-secure"}, "--code is only allowed"},
		{"invalid visibility", []string{"index.html", "--visibility", "friends"}, "invalid visibility"},
		{"subcommand code without access code", []string{"visibility", "pv1", "code"}, "--code is required"},
		{"subcommand access code with private", []string{"visibility", "pv1", "private", "--code", "letmein-secure"}, "--code is only allowed"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			cmd := newPreviewCmd(&rootOptions{})
			cmd.SetOut(io.Discard)
			cmd.SetErr(io.Discard)
			cmd.SetArgs(testCase.args)
			err := cmd.Execute()
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("err = %v, want %q", err, testCase.want)
			}
		})
	}
}

func TestPreviewVisibilitySubcommand(t *testing.T) {
	var method, path string
	var patchBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method = r.Method
		path = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&patchBody); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"pv1","name":"site","url":"https://preview.makarima.xyz/pv1/","totalBytes":14,"fileCount":1,"createdAt":1,"expiresAt":2,"visibility":"code"}`))
	}))
	defer server.Close()
	configPath := previewTestConfig(t, server.URL)
	cmd := newPreviewCmd(&rootOptions{config: configPath})
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"visibility", "pv1", "code", "--code", "letmein-secure"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPatch || path != "/api/v1/previews/pv1" {
		t.Fatalf("request = %s %s", method, path)
	}
	if patchBody["visibility"] != "code" || patchBody["accessCode"] != "letmein-secure" {
		t.Fatalf("unexpected patch body: %#v", patchBody)
	}
	if output.String() != "Preview pv1 visibility set to code.\n" {
		t.Fatalf("unexpected output: %q", output.String())
	}
}

func TestPreviewVisibilitySubcommandServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "preview not found", http.StatusNotFound)
	}))
	defer server.Close()
	configPath := previewTestConfig(t, server.URL)
	cmd := newPreviewCmd(&rootOptions{config: configPath})
	cmd.SetOut(io.Discard)
	cmd.SetErr(io.Discard)
	cmd.SetArgs([]string{"visibility", "pv1", "private"})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "status 404") || !strings.Contains(err.Error(), "preview not found") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPreviewListShowsVisibility(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"previews":[{"id":"pv1","name":"site","url":"https://preview.makarima.xyz/pv1/","totalBytes":14,"fileCount":2,"createdAt":1,"expiresAt":2,"visibility":"private"}]}`))
	}))
	defer server.Close()
	configPath := previewTestConfig(t, server.URL)
	cmd := newPreviewCmd(&rootOptions{config: configPath})
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"list"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(output.String(), "\n")
	header := strings.Fields(lines[0])
	if len(header) != 5 || header[1] != "NAME" || header[2] != "VISIBILITY" || header[3] != "FILES" {
		t.Fatalf("unexpected header: %q", lines[0])
	}
	row := strings.Fields(lines[1])
	if len(row) < 4 || row[0] != "pv1" || row[1] != "site" || row[2] != "private" || row[3] != "2" {
		t.Fatalf("unexpected row: %q", lines[1])
	}
}

func TestBuildPreviewManifestRejectsSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.txt")
	link := filepath.Join(directory, "link.txt")
	if err := os.WriteFile(target, []byte("target"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := buildPreviewManifest(link); err == nil {
		t.Fatal("expected symlink error")
	}
}

func TestParsePreviewRemote(t *testing.T) {
	tests := []struct {
		remote string
		host   string
		org    string
		name   string
	}{
		{"git@github.com:acme/site.git", "github.com", "acme", "site"},
		{"https://gitlab.example/acme/site.git", "gitlab.example", "acme", "site"},
		{"acme/site", "", "acme", "site"},
	}
	for _, testCase := range tests {
		t.Run(testCase.remote, func(t *testing.T) {
			parsed := parsePreviewRemote(&testCase.remote)
			if value := stringValue(parsed.host); value != testCase.host {
				t.Fatalf("host = %q, want %q", value, testCase.host)
			}
			if value := stringValue(parsed.org); value != testCase.org {
				t.Fatalf("org = %q, want %q", value, testCase.org)
			}
			if value := stringValue(parsed.name); value != testCase.name {
				t.Fatalf("name = %q, want %q", value, testCase.name)
			}
		})
	}
}

func TestCollectPreviewRepoMetadataOutsideGit(t *testing.T) {
	metadata := collectPreviewRepoMetadata(t.TempDir())
	if metadata.RepoHost != nil || metadata.RepoOrg != nil || metadata.RepoName != nil {
		t.Fatalf("unexpected repository metadata: %#v", metadata)
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
