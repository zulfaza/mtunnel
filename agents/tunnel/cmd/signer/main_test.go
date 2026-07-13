package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestSignRelease(t *testing.T) {
	directory := t.TempDir()
	asset := filepath.Join(directory, "mt-linux-amd64.tar.gz")
	if err := os.WriteFile(asset, []byte("binary"), 0o644); err != nil {
		t.Fatal(err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := signRelease(directory, "v1.2.3", base64.StdEncoding.EncodeToString(privateKey.Seed())); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	encodedSignature, err := os.ReadFile(filepath.Join(directory, "manifest.json.sig"))
	if err != nil {
		t.Fatal(err)
	}
	signature, err := base64.StdEncoding.DecodeString(string(encodedSignature))
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(publicKey, contents, signature) {
		t.Fatal("signature did not verify")
	}
	tampered := append([]byte(nil), contents...)
	tampered[0] ^= 1
	if ed25519.Verify(publicKey, tampered, signature) {
		t.Fatal("tampered manifest verified")
	}
	otherPublicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if ed25519.Verify(otherPublicKey, contents, signature) {
		t.Fatal("wrong key verified")
	}
}
