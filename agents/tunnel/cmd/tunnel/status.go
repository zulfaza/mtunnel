package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/spf13/cobra"
)

func newStatusCmd(o *rootOptions) *cobra.Command {
	return &cobra.Command{Use: "status [tunnel-id]", Short: "Show tunnel status", Args: cobra.MaximumNArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		id := o.name
		if len(args) == 1 {
			id = args[0]
		}
		if id == "" {
			return fmt.Errorf("tunnel identifier is required via --name or positional argument")
		}
		cfg, err := o.loadConfig()
		if err != nil {
			return err
		}
		base, err := url.Parse(cfg.Server)
		if err != nil {
			return fmt.Errorf("invalid server URL")
		}
		base.Path = strings.TrimRight(base.Path, "/") + "/api/v1/tunnels/" + url.PathEscape(id) + "/status"
		base.RawQuery = ""
		ctx := context.Background()
		resp, err := o.doAuthenticated(ctx, cfg, func(accessToken string) (*http.Request, error) {
			req, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
			if requestErr != nil {
				return nil, requestErr
			}
			req.Header.Set("Authorization", "Bearer "+accessToken)
			return req, nil
		})
		if err != nil {
			return fmt.Errorf("get tunnel status: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			return fmt.Errorf("get tunnel status: server returned status %d", resp.StatusCode)
		}
		var value map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&value); err != nil {
			return fmt.Errorf("decode tunnel status: %w", err)
		}
		out, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		_, err = fmt.Fprintln(cmd.OutOrStdout(), string(out))
		return err
	}}
}
