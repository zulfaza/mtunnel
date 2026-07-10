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

type dnsRecord struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

type domainResult struct {
	Hostname     string
	TunnelID     string
	Status       string
	CNAME        dnsRecord
	Verification dnsRecord
}

type domainWireResult struct {
	Hostname     string          `json:"hostname"`
	TunnelID     string          `json:"tunnelId"`
	Status       string          `json:"status"`
	CNAME        json.RawMessage `json:"cname"`
	Verification json.RawMessage `json:"verification"`
}

func decodeDNSRecord(value json.RawMessage, recordType, name string, required bool) (dnsRecord, error) {
	if len(value) == 0 || bytes.Equal(value, []byte("null")) {
		if required {
			return dnsRecord{}, fmt.Errorf("missing %s record", recordType)
		}
		return dnsRecord{}, nil
	}
	var record dnsRecord
	if err := json.Unmarshal(value, &record); err == nil {
		if record.Type == "" || record.Name == "" || record.Value == "" {
			return dnsRecord{}, fmt.Errorf("invalid %s record", recordType)
		}
		return record, nil
	}
	var legacyValue string
	if err := json.Unmarshal(value, &legacyValue); err != nil || legacyValue == "" {
		return dnsRecord{}, fmt.Errorf("invalid %s record", recordType)
	}
	return dnsRecord{Type: recordType, Name: name, Value: legacyValue}, nil
}

func decodeDomainResult(value []byte) (domainResult, error) {
	var wire domainWireResult
	if err := json.Unmarshal(value, &wire); err != nil {
		return domainResult{}, err
	}
	if wire.Hostname == "" || wire.TunnelID == "" || wire.Status == "" {
		return domainResult{}, fmt.Errorf("domain response missing required fields")
	}
	cname, err := decodeDNSRecord(wire.CNAME, "CNAME", wire.Hostname, true)
	if err != nil {
		return domainResult{}, err
	}
	verification, err := decodeDNSRecord(wire.Verification, "TXT", "_mtunnel."+wire.Hostname, false)
	if err != nil {
		return domainResult{}, err
	}
	return domainResult{
		Hostname:     wire.Hostname,
		TunnelID:     wire.TunnelID,
		Status:       wire.Status,
		CNAME:        cname,
		Verification: verification,
	}, nil
}

func domainEndpoint(server, path string) (string, error) {
	target, err := url.Parse(server)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return "", fmt.Errorf("invalid server URL")
	}
	target.Path = strings.TrimRight(target.Path, "/") + path
	target.RawQuery = ""
	return target.String(), nil
}

func executeDomainRequest(o *rootOptions, method, path string, body []byte) (domainResult, error) {
	cfg, err := o.loadConfig()
	if err != nil {
		return domainResult{}, err
	}
	target, err := domainEndpoint(cfg.Server, path)
	if err != nil {
		return domainResult{}, err
	}
	ctx := context.Background()
	resp, err := o.doAuthenticated(ctx, cfg, func(accessToken string) (*http.Request, error) {
		req, requestErr := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
		if requestErr != nil {
			return nil, requestErr
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		return req, nil
	})
	if err != nil {
		return domainResult{}, err
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return domainResult{}, err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return domainResult{}, fmt.Errorf("server returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(response)))
	}
	result, err := decodeDomainResult(response)
	if err != nil {
		return domainResult{}, fmt.Errorf("decode domain response: %w", err)
	}
	return result, nil
}

func printDNSInstructions(out io.Writer, result domainResult) error {
	if result.Verification.Value == "" {
		_, err := fmt.Fprintf(
			out,
			"Domain: %s\nStatus: %s\n\nCreate DNS record:\n%s %s → %s\n",
			result.Hostname,
			result.Status,
			result.CNAME.Type,
			result.CNAME.Name,
			result.CNAME.Value,
		)
		return err
	}
	_, err := fmt.Fprintf(
		out,
		"Domain: %s\nStatus: %s\n\nCreate DNS records:\n%s %s → %s\n%s %s → %s\n\nThen run:\nmt domain verify %s\n",
		result.Hostname,
		result.Status,
		result.CNAME.Type,
		result.CNAME.Name,
		result.CNAME.Value,
		result.Verification.Type,
		result.Verification.Name,
		result.Verification.Value,
		result.Hostname,
	)
	return err
}

func newDomainCmd(o *rootOptions) *cobra.Command {
	domain := &cobra.Command{Use: "domain", Short: "Manage custom domains"}
	domain.AddCommand(
		&cobra.Command{Use: "add <hostname>", Short: "Add a custom domain", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			if o.name == "" {
				return fmt.Errorf("tunnel name required via --name")
			}
			body, err := json.Marshal(struct {
				Hostname string `json:"hostname"`
				TunnelID string `json:"tunnelId"`
			}{args[0], o.name})
			if err != nil {
				return err
			}
			result, err := executeDomainRequest(o, http.MethodPost, "/api/v1/domains", body)
			if err != nil {
				return fmt.Errorf("add domain: %w", err)
			}
			return printDNSInstructions(cmd.OutOrStdout(), result)
		}},
		&cobra.Command{Use: "verify <hostname>", Short: "Verify DNS and provision a custom domain", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			result, err := executeDomainRequest(o, http.MethodPost, "/api/v1/domains/"+url.PathEscape(args[0])+"/verify", nil)
			if err != nil {
				return fmt.Errorf("verify domain: %w", err)
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Domain: %s\nStatus: %s\n", result.Hostname, result.Status)
			return err
		}},
		&cobra.Command{Use: "status <hostname>", Short: "Show custom domain status", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			result, err := executeDomainRequest(o, http.MethodGet, "/api/v1/domains/"+url.PathEscape(args[0])+"/status", nil)
			if err != nil {
				return fmt.Errorf("get domain status: %w", err)
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Domain: %s\nTunnel: %s\nStatus: %s\n", result.Hostname, result.TunnelID, result.Status)
			return err
		}},
	)
	return domain
}
