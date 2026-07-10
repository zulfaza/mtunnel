// Package auth mints short-lived agent tokens from a stored auth secret.
package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

func MintToken(ctx context.Context, client *http.Client, server, secret, tunnelID string) (string, error) {
	base, err := url.Parse(server)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", fmt.Errorf("invalid server URL")
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/v1/auth/token"
	base.RawQuery = ""
	body, err := json.Marshal(struct {
		TunnelID string `json:"tunnelId"`
	}{tunnelID})
	if err != nil {
		return "", fmt.Errorf("encode token request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("mint agent token: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("mint agent token: server returned status %d", resp.StatusCode)
	}
	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}
	if result.Token == "" {
		return "", fmt.Errorf("mint agent token: response missing token")
	}
	return result.Token, nil
}
