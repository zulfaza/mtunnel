package update

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const publicKeyBase64 = "B12X/7YmLu4Oc2eR1IKgywrVZAD2EVWJepcIONMBdTI="

var publicKeyBase64s = []string{publicKeyBase64}

var ErrNotNewer = errors.New("release is not newer")

type Manifest struct {
	Version string            `json:"version"`
	Assets  map[string]string `json:"assets"`
}

func FetchManifest(ctx context.Context, client *http.Client, current string, force bool) (Manifest, error) {
	publicKeys, err := decodePublicKeys(publicKeyBase64s)
	if err != nil {
		return Manifest{}, err
	}
	return fetchManifest(ctx, client, current, force, publicKeys, Latest, releaseURL)
}

func fetchManifest(ctx context.Context, client *http.Client, current string, force bool, publicKeys []ed25519.PublicKey, latest func(context.Context, *http.Client) (string, error), release func(string, string) string) (Manifest, error) {
	version, err := latest(ctx, client)
	if err != nil {
		return Manifest{}, fmt.Errorf("latest release: %w", err)
	}
	contents, err := fetch(ctx, client, release(version, "manifest.json"))
	if err != nil {
		return Manifest{}, fmt.Errorf("download manifest: %w", err)
	}
	encodedSignature, err := fetch(ctx, client, release(version, "manifest.json.sig"))
	if err != nil {
		return Manifest{}, fmt.Errorf("download manifest signature: %w", err)
	}
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encodedSignature)))
	if err != nil {
		return Manifest{}, fmt.Errorf("decode manifest signature: %w", err)
	}
	if len(signature) != ed25519.SignatureSize || !validSignature(publicKeys, contents, signature) {
		return Manifest{}, fmt.Errorf("verify manifest signature: invalid signature")
	}
	var manifest Manifest
	if err := json.Unmarshal(contents, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("parse manifest: %w", err)
	}
	if manifest.Version != version {
		return Manifest{}, fmt.Errorf("manifest version %q does not match release %q", manifest.Version, version)
	}
	if manifest.Version == "" || len(manifest.Assets) == 0 {
		return Manifest{}, fmt.Errorf("manifest is incomplete")
	}
	if !force && current != "dev" && !IsNewer(current, manifest.Version) {
		return Manifest{}, fmt.Errorf("%w: %s <= %s", ErrNotNewer, manifest.Version, current)
	}
	return manifest, nil
}

func decodePublicKeys(encodedKeys []string) ([]ed25519.PublicKey, error) {
	if len(encodedKeys) == 0 {
		return nil, fmt.Errorf("no embedded public keys")
	}
	keys := make([]ed25519.PublicKey, 0, len(encodedKeys))
	for _, encoded := range encodedKeys {
		key, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("decode embedded public key: %w", err)
		}
		if len(key) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("embedded public key must be %d bytes", ed25519.PublicKeySize)
		}
		keys = append(keys, ed25519.PublicKey(key))
	}
	return keys, nil
}

func validSignature(publicKeys []ed25519.PublicKey, contents, signature []byte) bool {
	for _, publicKey := range publicKeys {
		if ed25519.Verify(publicKey, contents, signature) {
			return true
		}
	}
	return false
}

func releaseURL(version, name string) string {
	return "https://github.com/" + repo + "/releases/download/" + version + "/" + name
}

func fetch(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %s", resp.Status)
	}
	contents, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return contents, nil
}
