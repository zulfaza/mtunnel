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

func Save(path string, cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("set config permissions: %w", err)
	}
	return nil
}
