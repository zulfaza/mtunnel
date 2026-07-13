package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type manifest struct {
	Version string            `json:"version"`
	Assets  map[string]string `json:"assets"`
}

func main() {
	generate := flag.Bool("gen", false, "generate a signing keypair")
	flag.Parse()
	if *generate {
		if err := generateKeypair(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := signRelease(".", os.Getenv("RELEASE_VERSION"), os.Getenv("SIGNING_KEY")); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func generateKeypair() error {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("generate signing key: %w", err)
	}
	fmt.Printf("SIGNING_KEY=%s\n", base64.StdEncoding.EncodeToString(privateKey.Seed()))
	fmt.Printf("PUBLIC_KEY=%s\n", base64.StdEncoding.EncodeToString(publicKey))
	return nil
}

func signRelease(directory, version, encodedSeed string) error {
	if version == "" {
		return errors.New("RELEASE_VERSION is required")
	}
	seed, err := base64.StdEncoding.DecodeString(encodedSeed)
	if err != nil {
		return fmt.Errorf("decode SIGNING_KEY: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return fmt.Errorf("SIGNING_KEY must decode to %d bytes", ed25519.SeedSize)
	}
	assets, err := filepath.Glob(filepath.Join(directory, "mt-*.tar.gz"))
	if err != nil {
		return fmt.Errorf("find assets: %w", err)
	}
	if len(assets) == 0 {
		return errors.New("no release assets found")
	}
	sort.Strings(assets)
	result := manifest{Version: version, Assets: make(map[string]string, len(assets))}
	for _, asset := range assets {
		contents, err := os.ReadFile(asset)
		if err != nil {
			return fmt.Errorf("read %s: %w", asset, err)
		}
		checksum := sha256.Sum256(contents)
		result.Assets[filepath.Base(asset)] = hex.EncodeToString(checksum[:])
	}
	contents, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	signature := ed25519.Sign(privateKey, contents)
	if err := os.WriteFile(filepath.Join(directory, "manifest.json"), contents, 0o644); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(directory, "manifest.json.sig"), []byte(base64.StdEncoding.EncodeToString(signature)), 0o644); err != nil {
		return fmt.Errorf("write manifest signature: %w", err)
	}
	return nil
}
