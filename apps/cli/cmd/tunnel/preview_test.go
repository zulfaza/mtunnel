package main

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
