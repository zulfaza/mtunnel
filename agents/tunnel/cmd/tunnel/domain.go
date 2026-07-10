package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/spf13/cobra"
)

func newDomainCmd(o *rootOptions) *cobra.Command {
	domain := &cobra.Command{Use: "domain", Short: "Manage custom domains"}
	domain.AddCommand(&cobra.Command{Use: "add <hostname>", Short: "Route a custom domain to a tunnel", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		if o.name == "" {
			return fmt.Errorf("tunnel name required via --name")
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
			return fmt.Errorf("login required; run tunnel login")
		}
		target, err := url.Parse(cfg.Server)
		if err != nil {
			return fmt.Errorf("invalid server URL")
		}
		target.Path = strings.TrimRight(target.Path, "/") + "/api/v1/domains"
		target.RawQuery = ""
		body, err := json.Marshal(struct {
			Hostname string `json:"hostname"`
			TunnelID string `json:"tunnelId"`
		}{args[0], o.name})
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, target.String(), bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return fmt.Errorf("add domain: %w", err)
		}
		defer resp.Body.Close()
		response, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return err
		}
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("add domain: server returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(response)))
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Domain added: https://%s\nCreate CNAME: %s → makarima.xyz\n", args[0], args[0])
		return nil
	}})
	return domain
}
