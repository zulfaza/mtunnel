// Package config persists the tunnel server and authentication secret.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

const ProjectFilename = "mtunnel.config.json"

type Config struct {
	Server         string `json:"server"`
	AccessToken    string `json:"accessToken"`
	RefreshToken   string `json:"refreshToken,omitempty"`
	OrganizationID string `json:"organizationId,omitempty"`
	Secret         string `json:"secret,omitempty"` // Legacy development config.
}

type ProjectConfig struct {
	Tunnels map[string]Tunnel `json:"tunnels"`
}

type Tunnel struct {
	Port     int    `json:"port"`
	Hostname string `json:"hostname,omitempty"`
}

func DefaultPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(".config", "tunnel", "config.json")
	}
	return filepath.Join(dir, "tunnel", "config.json")
}

func Load(path string) (Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	return cfg, nil
}

func LoadProject(startDirectory string) (ProjectConfig, string, error) {
	directory, err := filepath.Abs(startDirectory)
	if err != nil {
		return ProjectConfig{}, "", fmt.Errorf("resolve project config directory: %w", err)
	}
	for {
		path := filepath.Join(directory, ProjectFilename)
		contents, err := os.ReadFile(path)
		if err == nil {
			var projectConfig ProjectConfig
			if err := json.Unmarshal(contents, &projectConfig); err != nil {
				return ProjectConfig{}, path, fmt.Errorf("decode project config %s: %w", path, err)
			}
			return projectConfig, path, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return ProjectConfig{}, path, fmt.Errorf("read project config %s: %w", path, err)
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return ProjectConfig{}, "", fs.ErrNotExist
		}
		directory = parent
	}
}

// Save writes through a temporary file in the same directory so a concurrent
// reader never observes a half-written config, and so a crash mid-write cannot
// destroy the stored credentials.
func Save(path string, cfg Config) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	temporary, err := os.CreateTemp(directory, filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create config temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("set config permissions: %w", err)
	}
	if _, err := temporary.Write(b); err != nil {
		temporary.Close()
		return fmt.Errorf("write config: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	return nil
}

// SaveCredentials stores rotated tokens while keeping every other stored field.
func SaveCredentials(path string, cfg Config, accessToken, refreshToken string) error {
	cfg.AccessToken = accessToken
	cfg.RefreshToken = refreshToken
	return Save(path, cfg)
}

// LatestRefreshToken re-reads the stored refresh token because WorkOS rotates it
// on every refresh: a long-running agent must not present the copy it captured
// at startup after another mt process has already rotated it.
func LatestRefreshToken(path, fallback string) string {
	stored, err := Load(path)
	if err != nil || stored.RefreshToken == "" {
		return fallback
	}
	return stored.RefreshToken
}
