package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"math/big"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/agent"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/auth"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/config"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/protocol"
)

func newHTTPCmd(o *rootOptions) *cobra.Command {
	return &cobra.Command{Use: "http <port|name>", Short: "Open an HTTP tunnel", Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
		port, tunnelName, configuredHostname, usedProjectConfig, err := resolveHTTPTarget(args[0])
		if err != nil {
			return err
		}
		cfg, err := o.loadConfig()
		if err != nil {
			return err
		}
		accessToken := cfg.AccessToken
		if accessToken == "" {
			accessToken = cfg.Secret
		}
		if accessToken == "" {
			return fmt.Errorf("login required; run mt login")
		}
		name := o.name
		if name == "" {
			name = tunnelName
			if name == "" {
				name = randomName(8)
			}
		}
		hostname := o.hostname
		if !cmd.Flags().Changed("hostname") && configuredHostname != "" {
			hostname = configuredHostname
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
		defer signal.Stop(signals)
		shutdownRequested := make(chan struct{})
		go func() {
			select {
			case <-signals:
				signal.Stop(signals)
				close(shutdownRequested)
				fmt.Fprintln(cmd.ErrOrStderr(), "Shutting down tunnel…")
				cancel()
			case <-ctx.Done():
			}
		}()
		first := true
		usageSource := "terminal"
		if usedProjectConfig {
			usageSource = "project_config"
		}
		err = agent.Run(ctx, agent.Options{Server: cfg.Server, Secret: accessToken, RefreshToken: cfg.RefreshToken, OnCredentials: func(credentials auth.Credentials) error {
			return config.Save(o.config, config.Config{Server: cfg.Server, AccessToken: credentials.AccessToken, RefreshToken: credentials.RefreshToken, OrganizationID: cfg.OrganizationID})
		}, TunnelID: name, OrganizationID: cfg.OrganizationID, Hostname: hostname, Port: port, RequestTimeout: o.requestTimeout, IdleTimeout: o.idleTimeout, Logger: o.logger, UsageSource: usageSource, OnConnected: func(ack protocol.HelloAck, reconnected bool) {
			if first && !reconnected {
				fmt.Fprintf(cmd.OutOrStdout(), "Tunnel connected\n\nPublic URL:\n%s\n\nForwarding:\nhttp://%s:%d\n", ack.PublicURL, hostname, port)
				first = false
			}
		}})
		select {
		case <-shutdownRequested:
			fmt.Fprintln(cmd.ErrOrStderr(), "Tunnel stopped.")
		default:
		}
		return err
	}}
}

func resolveHTTPTarget(value string) (int, string, string, bool, error) {
	port, err := parsePort(value)
	if err == nil {
		return port, "", "", false, nil
	}
	if _, conversionError := strconv.Atoi(value); conversionError == nil {
		return 0, "", "", false, err
	}
	workingDirectory, workingDirectoryError := os.Getwd()
	if workingDirectoryError != nil {
		return 0, "", "", false, fmt.Errorf("get working directory: %w", workingDirectoryError)
	}
	projectConfig, path, loadError := config.LoadProject(workingDirectory)
	if loadError != nil {
		if errors.Is(loadError, fs.ErrNotExist) {
			return 0, "", "", false, err
		}
		return 0, "", "", false, loadError
	}
	tunnel, exists := projectConfig.Tunnels[value]
	if !exists {
		return 0, "", "", false, fmt.Errorf("tunnel %q not found in %s", value, path)
	}
	if _, err := parsePort(strconv.Itoa(tunnel.Port)); err != nil {
		return 0, "", "", false, fmt.Errorf("tunnel %q in %s has invalid port %d", value, path, tunnel.Port)
	}
	return tunnel.Port, value, tunnel.Hostname, true, nil
}

func parsePort(value string) (int, error) {
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("port must be a valid TCP port (1-65535)")
	}
	return port, nil
}

func randomName(length int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	var b strings.Builder
	b.Grow(length)
	for range length {
		n, err := rand.Int(rand.Reader, bigInt(int64(len(alphabet))))
		if err != nil {
			panic(err)
		}
		b.WriteByte(alphabet[n.Int64()])
	}
	return b.String()
}

func bigInt(n int64) *big.Int { return big.NewInt(n) }
