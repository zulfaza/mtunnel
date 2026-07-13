// Package auth implements WorkOS device login and short-lived tunnel tokens.
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
	"time"
)

type DeviceAuthorization struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type Credentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func endpoint(server, path string) (string, error) {
	base, err := url.Parse(server)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", fmt.Errorf("invalid server URL")
	}
	base.Path = strings.TrimRight(base.Path, "/") + path
	base.RawQuery = ""
	return base.String(), nil
}

func postJSON(ctx context.Context, client *http.Client, target string, body any, result any) (int, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(b))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(result)
		return resp.StatusCode, nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(result); err != nil {
		return resp.StatusCode, err
	}
	return resp.StatusCode, nil
}

func StartDeviceLogin(ctx context.Context, client *http.Client, server string) (DeviceAuthorization, error) {
	target, err := endpoint(server, "/api/v1/auth/device")
	if err != nil {
		return DeviceAuthorization{}, err
	}
	var result DeviceAuthorization
	status, err := postJSON(ctx, client, target, struct{}{}, &result)
	if err != nil {
		return result, fmt.Errorf("start login: %w", err)
	}
	if status != http.StatusOK || result.DeviceCode == "" {
		return result, fmt.Errorf("start login: server returned status %d", status)
	}
	return result, nil
}

func WaitForDeviceLogin(ctx context.Context, client *http.Client, server string, device DeviceAuthorization) (Credentials, error) {
	target, err := endpoint(server, "/api/v1/auth/device/token")
	if err != nil {
		return Credentials{}, err
	}
	interval := max(device.Interval, 1)
	expiresIn := device.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 300
	}
	deadline := time.NewTimer(time.Duration(expiresIn) * time.Second)
	defer deadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return Credentials{}, ctx.Err()
		case <-deadline.C:
			return Credentials{}, fmt.Errorf("login expired")
		case <-time.After(time.Duration(interval) * time.Second):
			var result struct {
				Credentials
				Error string `json:"error"`
			}
			status, requestErr := postJSON(ctx, client, target, struct {
				DeviceCode string `json:"deviceCode"`
			}{device.DeviceCode}, &result)
			if requestErr != nil {
				return Credentials{}, fmt.Errorf("complete login: %w", requestErr)
			}
			if status == http.StatusOK && result.AccessToken != "" {
				return result.Credentials, nil
			}
			switch result.Error {
			case "authorization_pending":
				continue
			case "slow_down":
				interval++
				continue
			case "access_denied":
				return Credentials{}, fmt.Errorf("login denied")
			case "expired_token":
				return Credentials{}, fmt.Errorf("login expired")
			}
			return Credentials{}, fmt.Errorf("complete login: server returned status %d", status)
		}
	}
}

func Refresh(ctx context.Context, client *http.Client, server, refreshToken string) (Credentials, error) {
	target, err := endpoint(server, "/api/v1/auth/refresh")
	if err != nil {
		return Credentials{}, err
	}
	var result Credentials
	status, err := postJSON(ctx, client, target, struct {
		RefreshToken string `json:"refreshToken"`
	}{refreshToken}, &result)
	if err != nil {
		return result, fmt.Errorf("refresh login: %w", err)
	}
	if status != http.StatusOK || result.AccessToken == "" || result.RefreshToken == "" {
		return result, fmt.Errorf("refresh login: server returned status %d", status)
	}
	return result, nil
}

func MintToken(ctx context.Context, client *http.Client, server, accessToken, tunnelID string) (string, error) {
	target, err := endpoint(server, "/api/v1/auth/token")
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(struct {
		TunnelID string `json:"tunnelId"`
	}{tunnelID})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
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
