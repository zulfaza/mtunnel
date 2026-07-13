package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/zulfaza/mtunnel/agents/tunnel/internal/config"
)

func TestPreviewCommands(t *testing.T) {
	key := "org_1/user_1/2026-07-13-plan.html"
	var uploadVisibility string
	var visibilityUpdate string
	var deleted bool
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer access" {
			http.Error(writer, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/previews":
			if err := request.ParseMultipartForm(maxPreviewBytes); err != nil {
				t.Fatal(err)
			}
			uploadVisibility = request.FormValue("visibility")
			file, header, err := request.FormFile("file")
			if err != nil {
				t.Fatal(err)
			}
			file.Close()
			if header.Filename != "plan.html" {
				t.Fatalf("filename = %q", header.Filename)
			}
			json.NewEncoder(writer).Encode(preview{Key: key, URL: server.URL + "/preview", Visibility: uploadVisibility})
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/previews":
			json.NewEncoder(writer).Encode(struct {
				Previews []preview `json:"previews"`
			}{Previews: []preview{{Key: key, URL: server.URL + "/preview", Visibility: "public", Size: 13, UploadedAt: time.Date(2026, time.July, 13, 0, 0, 0, 0, time.UTC)}}})
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/previews/org_1/user_1/2026-07-13-plan.html":
			var body struct {
				Visibility string `json:"visibility"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			visibilityUpdate = body.Visibility
			writer.Write([]byte(`{}`))
		case request.Method == http.MethodDelete && request.URL.Path == "/api/v1/previews/org_1/user_1/2026-07-13-plan.html":
			deleted = true
			writer.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, config.Config{Server: server.URL, AccessToken: "access"}); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(t.TempDir(), "plan.html")
	if err := os.WriteFile(filename, []byte("<h1>Plan</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	o := rootOptions{config: configPath}
	output := bytes.Buffer{}
	command := newPreviewCmd(&o)
	command.SetOut(&output)
	command.SetArgs([]string{"upload", filename, "--visibility", "public"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if uploadVisibility != "public" || output.String() != server.URL+"/preview\n" {
		t.Fatalf("upload output = %q, visibility = %q", output.String(), uploadVisibility)
	}

	output.Reset()
	command = newPreviewCmd(&o)
	command.SetOut(&output)
	command.SetArgs([]string{"list"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte(key)) || !bytes.Contains(output.Bytes(), []byte("public")) {
		t.Fatalf("unexpected list output: %q", output.String())
	}

	command = newPreviewCmd(&o)
	command.SetArgs([]string{"visibility", key, "organization"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if visibilityUpdate != "organization" {
		t.Fatalf("visibility update = %q", visibilityUpdate)
	}

	command = newPreviewCmd(&o)
	command.SetArgs([]string{"delete", key})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Fatal("preview not deleted")
	}
}
