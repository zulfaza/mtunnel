// Package update checks GitHub releases for newer mt versions.
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	repo         = "zulfaza/mtunnel"
	latestURL    = "https://api.github.com/repos/" + repo + "/releases/latest"
	cacheTTL     = 24 * time.Hour
	fetchTimeout = 2 * time.Second
)

type cache struct {
	CheckedAt time.Time `json:"checkedAt"`
	Latest    string    `json:"latest"`
}

// CachePath returns the location used to remember the last checked version,
// alongside the given config file path.
func CachePath(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), "update-check.json")
}

// Latest fetches the latest published release tag from GitHub.
func Latest(ctx context.Context, client *http.Client) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, latestURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github releases: unexpected status %s", resp.Status)
	}
	var body struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.TagName == "" {
		return "", fmt.Errorf("github releases: empty tag name")
	}
	return body.TagName, nil
}

// CheckCached returns the latest known version, using a cached result when
// it is fresh and only reaching out to GitHub when the cache has expired.
func CheckCached(ctx context.Context, client *http.Client, cachePath string) (string, error) {
	if cached, ok := readCache(cachePath); ok && time.Since(cached.CheckedAt) < cacheTTL {
		return cached.Latest, nil
	}
	latest, err := Latest(ctx, client)
	if err != nil {
		if cached, ok := readCache(cachePath); ok {
			return cached.Latest, nil
		}
		return "", err
	}
	_ = writeCache(cachePath, cache{CheckedAt: time.Now(), Latest: latest})
	return latest, nil
}

// IsNewer reports whether latest is a newer version than current. Versions
// are compared as dot-separated numeric components, ignoring a leading "v".
// Non-numeric or empty versions (e.g. "dev" builds) never report an update.
func IsNewer(current, latest string) bool {
	currentParts, ok := parseVersion(current)
	if !ok {
		return false
	}
	latestParts, ok := parseVersion(latest)
	if !ok {
		return false
	}
	for i := 0; i < len(currentParts) || i < len(latestParts); i++ {
		var c, l int
		if i < len(currentParts) {
			c = currentParts[i]
		}
		if i < len(latestParts) {
			l = latestParts[i]
		}
		if l != c {
			return l > c
		}
	}
	return false
}

func parseVersion(version string) ([]int, bool) {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	if version == "" {
		return nil, false
	}
	segments := strings.SplitN(version, "-", 2)[0]
	parts := strings.Split(segments, ".")
	numbers := make([]int, len(parts))
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		numbers[i] = n
	}
	return numbers, true
}

func readCache(path string) (cache, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return cache{}, false
	}
	var c cache
	if err := json.Unmarshal(b, &c); err != nil {
		return cache{}, false
	}
	return c, true
}

func writeCache(path string, c cache) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}
