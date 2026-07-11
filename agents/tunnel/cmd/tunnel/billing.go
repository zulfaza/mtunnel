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

type billingStatus struct {
	OrganizationID        string `json:"organizationId"`
	Plan                  string `json:"plan"`
	CustomDomainLimit     int    `json:"customDomainLimit"`
	TunnelLimit           *int   `json:"tunnelLimit"`
	TunnelLifetimeSeconds *int   `json:"tunnelLifetimeSeconds"`
	MaximumIdleSeconds    int    `json:"maximumIdleSeconds"`
}

func executeBillingRequest(o *rootOptions, method, path string, body []byte, output any) error {
	cfg, err := o.loadConfig()
	if err != nil {
		return err
	}
	target, err := url.Parse(cfg.Server)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return fmt.Errorf("invalid server URL")
	}
	target.Path = strings.TrimRight(target.Path, "/") + path
	target.RawQuery = ""
	ctx := context.Background()
	response, err := o.doAuthenticated(ctx, cfg, func(accessToken string) (*http.Request, error) {
		request, requestErr := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(body))
		if requestErr == nil {
			request.Header.Set("Authorization", "Bearer "+accessToken)
			if len(body) > 0 {
				request.Header.Set("Content-Type", "application/json")
			}
		}
		return request, requestErr
	})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		value, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return fmt.Errorf("server returned status %d: %s", response.StatusCode, strings.TrimSpace(string(value)))
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(output)
}

func newBillingCmd(o *rootOptions) *cobra.Command {
	billing := &cobra.Command{Use: "billing", Short: "Manage organization billing"}
	var amount int
	qris := &cobra.Command{Use: "qris", Short: "Buy one custom-domain credit with QRIS", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		body, err := json.Marshal(map[string]int{"amountIdr": amount})
		if err != nil {
			return err
		}
		var value any
		if err := executeBillingRequest(o, http.MethodPost, "/api/v1/billing/qris", body, &value); err != nil {
			return fmt.Errorf("create QRIS payment: %w", err)
		}
		encoded, err := json.MarshalIndent(value, "", "  ")
		if err == nil {
			_, err = fmt.Fprintln(cmd.OutOrStdout(), string(encoded))
		}
		return err
	}}
	qris.Flags().IntVar(&amount, "amount", 10000, "payment amount in IDR (minimum 10000)")
	billing.AddCommand(qris)
	billing.AddCommand(&cobra.Command{Use: "subscribe", Short: "Start the Rp50,000 monthly card subscription", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		var value struct {
			URL string `json:"url"`
		}
		if err := executeBillingRequest(o, http.MethodPost, "/api/v1/billing/stripe", nil, &value); err != nil {
			return fmt.Errorf("create card checkout: %w", err)
		}
		if value.URL == "" {
			return fmt.Errorf("Stripe response did not include a checkout URL")
		}
		_, err := fmt.Fprintln(cmd.OutOrStdout(), value.URL)
		return err
	}})
	billing.AddCommand(&cobra.Command{Use: "portal", Short: "Manage or cancel the card subscription", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		var value struct {
			URL string `json:"url"`
		}
		if err := executeBillingRequest(o, http.MethodPost, "/api/v1/billing/portal", nil, &value); err != nil {
			return fmt.Errorf("create billing portal: %w", err)
		}
		if value.URL == "" {
			return fmt.Errorf("Stripe response did not include a portal URL")
		}
		_, err := fmt.Fprintln(cmd.OutOrStdout(), value.URL)
		return err
	}})
	billing.AddCommand(&cobra.Command{Use: "status", Short: "Show organization plan and limits", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		var value billingStatus
		if err := executeBillingRequest(o, http.MethodGet, "/api/v1/billing/status", nil, &value); err != nil {
			return fmt.Errorf("get billing status: %w", err)
		}
		encoded, err := json.MarshalIndent(value, "", "  ")
		if err == nil {
			_, err = fmt.Fprintln(cmd.OutOrStdout(), string(encoded))
		}
		return err
	}})
	return billing
}
