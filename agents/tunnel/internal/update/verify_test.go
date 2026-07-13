package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestFetchManifestVerifiesSignatureAndDowngrade(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{Version: "v2.0.0", Assets: map[string]string{"mt-linux-amd64.tar.gz": "abc"}}
	contents, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, contents))
	server := manifestServer(t, contents, []byte(signature))
	defer server.Close()
	latest := func(context.Context, *http.Client) (string, error) { return "v2.0.0", nil }
	release := func(_ string, name string) string { return server.URL + "/" + name }
	if _, err := fetchManifest(context.Background(), server.Client(), "v1.0.0", false, []ed25519.PublicKey{publicKey}, latest, release); err != nil {
		t.Fatal(err)
	}
	if _, err := fetchManifest(context.Background(), server.Client(), "v2.0.0", false, []ed25519.PublicKey{publicKey}, latest, release); !errors.Is(err, ErrNotNewer) {
		t.Fatalf("equal version error = %v", err)
	}
	if _, err := fetchManifest(context.Background(), server.Client(), "v3.0.0", true, []ed25519.PublicKey{publicKey}, latest, release); err != nil {
		t.Fatal(err)
	}
	otherPublicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fetchManifest(context.Background(), server.Client(), "v1.0.0", false, []ed25519.PublicKey{otherPublicKey}, latest, release); err == nil {
		t.Fatal("bad signature verified")
	}
	if _, err := fetchManifest(context.Background(), server.Client(), "v1.0.0", false, []ed25519.PublicKey{publicKey}, latest, func(_ string, name string) string {
		if name == "manifest.json.sig" {
			return server.URL + "/short"
		}
		return server.URL + "/manifest.json"
	}); err == nil {
		t.Fatal("truncated signature verified")
	}
}

func TestApplyChecksHashBeforeReplacingBinary(t *testing.T) {
	archive := testArchive(t, []byte("new binary"))
	asset := "mt-" + runtime.GOOS + "-" + runtime.GOARCH + ".tar.gz"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { _, _ = response.Write(archive) }))
	defer server.Close()
	target := filepath.Join(t.TempDir(), "mt")
	if err := os.WriteFile(target, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{Version: "v2.0.0", Assets: map[string]string{asset: "wrong"}}
	release := func(string, string) string { return server.URL }
	executable := func() (string, error) { return target, nil }
	if err := apply(context.Background(), server.Client(), manifest, release, executable); err == nil {
		t.Fatal("hash mismatch applied update")
	}
	contents, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "old binary" {
		t.Fatalf("target = %q", contents)
	}
	checksum := sha256.Sum256(archive)
	manifest.Assets[asset] = hex.EncodeToString(checksum[:])
	if err := apply(context.Background(), server.Client(), manifest, release, executable); err != nil {
		t.Fatal(err)
	}
	contents, err = os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new binary" {
		t.Fatalf("target = %q", contents)
	}
	delete(manifest.Assets, asset)
	if err := apply(context.Background(), server.Client(), manifest, release, executable); err == nil {
		t.Fatal("missing platform asset applied update")
	}
}

func manifestServer(t *testing.T, manifest, signature []byte) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/manifest.json":
			_, _ = response.Write(manifest)
		case "/manifest.json.sig":
			_, _ = response.Write(signature)
		case "/short":
			_, _ = response.Write([]byte("abc"))
		default:
			http.NotFound(response, request)
		}
	}))
}

func testArchive(t *testing.T, contents []byte) []byte {
	t.Helper()
	var output bytes.Buffer
	gzipWriter := gzip.NewWriter(&output)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "mt", Mode: 0o755, Size: int64(len(contents))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(contents); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
