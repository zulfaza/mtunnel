package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/auth"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/config"
)

func newLoginCmd(o *rootOptions) *cobra.Command {
	return &cobra.Command{Use: "login", Short: "Sign in with Google through WorkOS", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		server := strings.TrimRight(strings.TrimSpace(o.server), "/")
		if server == "" {
			server = "https://makarima.xyz"
		}
		device, err := auth.StartDeviceLogin(context.Background(), http.DefaultClient, server)
		if err != nil {
			return err
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Open this URL:\n%s\n\nConfirm code: %s\nWaiting for sign-in…\n", device.VerificationURIComplete, device.UserCode)
		credentials, err := auth.WaitForDeviceLogin(context.Background(), http.DefaultClient, server, device)
		if err != nil {
			return err
		}
		if err := config.Save(o.config, config.Config{Server: server, AccessToken: credentials.AccessToken, RefreshToken: credentials.RefreshToken}); err != nil {
			return err
		}
		fmt.Fprintln(cmd.OutOrStdout(), "Signed in.")
		return nil
	}}
}
