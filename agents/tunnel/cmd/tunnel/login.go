package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"
	"github.com/zul/ztunnel/agents/tunnel/internal/auth"
	"github.com/zul/ztunnel/agents/tunnel/internal/config"
)

func newLoginCmd(o *rootOptions) *cobra.Command {
	return &cobra.Command{Use: "login", Short: "Store tunnel server credentials", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		server, err := prompt(cmd.OutOrStdout(), cmd.InOrStdin(), "Server URL")
		if err != nil {
			return err
		}
		secret, err := prompt(cmd.OutOrStdout(), cmd.InOrStdin(), "Auth secret")
		if err != nil {
			return err
		}
		server = strings.TrimRight(strings.TrimSpace(server), "/")
		secret = strings.TrimSpace(secret)
		if server == "" || secret == "" {
			return fmt.Errorf("server URL and auth secret are required")
		}
		if _, err := auth.MintToken(context.Background(), http.DefaultClient, server, secret, "login-probe-"+randomHex(4)); err != nil {
			return fmt.Errorf("login verification failed: %w", err)
		}
		if err := config.Save(o.config, config.Config{Server: server, Secret: secret}); err != nil {
			return err
		}
		return nil
	}}
}

func randomHex(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
