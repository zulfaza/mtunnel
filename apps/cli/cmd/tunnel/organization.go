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
	"text/tabwriter"

	"github.com/spf13/cobra"
	"github.com/zulfaza/mtunnel/apps/cli/internal/config"
)

type organization struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type organizationMember struct {
	MembershipID string `json:"membershipId"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	Status       string `json:"status"`
}

func executeOrganizationHTTP(o *rootOptions, method, path string, body []byte) ([]byte, error) {
	cfg, err := o.loadConfig()
	if err != nil {
		return nil, err
	}
	target, err := domainEndpoint(cfg.Server, path)
	if err != nil {
		return nil, err
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
		return nil, err
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("server returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(response)))
	}
	return response, nil
}

func executeOrganizationList(o *rootOptions) ([]organization, string, error) {
	response, err := executeOrganizationHTTP(o, http.MethodGet, "/api/v1/organizations", nil)
	if err != nil {
		return nil, "", err
	}
	var value struct {
		Organizations         []organization `json:"organizations"`
		CurrentOrganizationID string         `json:"currentOrganizationId"`
	}
	if err := json.Unmarshal(response, &value); err != nil {
		return nil, "", fmt.Errorf("decode organization list: %w", err)
	}
	return value.Organizations, value.CurrentOrganizationID, nil
}

func printOrganizationList(out io.Writer, organizations []organization, currentID string) error {
	if len(organizations) == 0 {
		_, err := fmt.Fprintln(out, "No organizations.")
		return err
	}
	writer := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(writer, "CURRENT\tID\tNAME"); err != nil {
		return err
	}
	for _, org := range organizations {
		marker := ""
		if org.ID == currentID {
			marker = "*"
		}
		if _, err := fmt.Fprintf(writer, "%s\t%s\t%s\n", marker, org.ID, org.Name); err != nil {
			return err
		}
	}
	return writer.Flush()
}

func printOrganizationMembers(out io.Writer, members []organizationMember) error {
	if len(members) == 0 {
		_, err := fmt.Fprintln(out, "No members.")
		return err
	}
	writer := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(writer, "NAME\tEMAIL\tROLE\tSTATUS\tMEMBERSHIP"); err != nil {
		return err
	}
	for _, member := range members {
		if _, err := fmt.Fprintf(writer, "%s\t%s\t%s\t%s\t%s\n", member.Name, member.Email, member.Role, member.Status, member.MembershipID); err != nil {
			return err
		}
	}
	return writer.Flush()
}

func newOrganizationCmd(o *rootOptions) *cobra.Command {
	organizationCmd := &cobra.Command{Use: "org", Aliases: []string{"organization"}, Short: "Manage organizations"}
	organizationCmd.AddCommand(
		&cobra.Command{Use: "list", Aliases: []string{"ls"}, Short: "List organizations you belong to", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
			organizations, currentID, err := executeOrganizationList(o)
			if err != nil {
				return fmt.Errorf("list organizations: %w", err)
			}
			return printOrganizationList(cmd.OutOrStdout(), organizations, currentID)
		}},
		&cobra.Command{Use: "create <name>", Short: "Create a new organization and switch to it", Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
			body, err := json.Marshal(struct {
				Name string `json:"name"`
			}{args[0]})
			if err != nil {
				return err
			}
			response, err := executeOrganizationHTTP(o, http.MethodPost, "/api/v1/organizations", body)
			if err != nil {
				return fmt.Errorf("create organization: %w", err)
			}
			var org organization
			if err := json.Unmarshal(response, &org); err != nil {
				return fmt.Errorf("decode organization: %w", err)
			}
			cfg, err := o.loadConfig()
			if err != nil {
				return err
			}
			cfg.OrganizationID = org.ID
			if err := config.Save(o.config, *cfg); err != nil {
				return err
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Created organization %s (%s) and switched to it.\n", org.Name, org.ID)
			return err
		}},
		&cobra.Command{Use: "use <id>", Short: "Switch the active organization", Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
			organizations, _, err := executeOrganizationList(o)
			if err != nil {
				return fmt.Errorf("switch organization: %w", err)
			}
			var matched *organization
			for i := range organizations {
				if organizations[i].ID == args[0] {
					matched = &organizations[i]
					break
				}
			}
			if matched == nil {
				return fmt.Errorf("organization %q not found; run mt org list", args[0])
			}
			cfg, err := o.loadConfig()
			if err != nil {
				return err
			}
			cfg.OrganizationID = matched.ID
			if err := config.Save(o.config, *cfg); err != nil {
				return err
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Switched to organization %s (%s).\n", matched.Name, matched.ID)
			return err
		}},
		&cobra.Command{Use: "rename <id> <name>", Short: "Rename an organization", Args: exactArgsWithHelp(2), RunE: func(cmd *cobra.Command, args []string) error {
			body, err := json.Marshal(struct {
				Name string `json:"name"`
			}{args[1]})
			if err != nil {
				return err
			}
			response, err := executeOrganizationHTTP(o, http.MethodPut, "/api/v1/organizations/"+url.PathEscape(args[0]), body)
			if err != nil {
				return fmt.Errorf("rename organization: %w", err)
			}
			var updated organization
			if err := json.Unmarshal(response, &updated); err != nil {
				return fmt.Errorf("decode organization: %w", err)
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Renamed organization to %s (%s).\n", updated.Name, updated.ID)
			return err
		}},
		&cobra.Command{Use: "invite <id> <email>", Short: "Invite an organization member", Args: exactArgsWithHelp(2), RunE: func(cmd *cobra.Command, args []string) error {
			body, err := json.Marshal(struct {
				Email string `json:"email"`
			}{args[1]})
			if err != nil {
				return err
			}
			_, err = executeOrganizationHTTP(o, http.MethodPost, "/api/v1/organizations/"+url.PathEscape(args[0])+"/invitations", body)
			if err != nil {
				return fmt.Errorf("invite organization member: %w", err)
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Invited %s to organization %s.\n", args[1], args[0])
			return err
		}},
		&cobra.Command{Use: "members <id>", Short: "List organization members", Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
			response, err := executeOrganizationHTTP(o, http.MethodGet, "/api/v1/organizations/"+url.PathEscape(args[0])+"/members", nil)
			if err != nil {
				return fmt.Errorf("list organization members: %w", err)
			}
			var result struct {
				Members []organizationMember `json:"members"`
			}
			if err := json.Unmarshal(response, &result); err != nil {
				return fmt.Errorf("decode organization members: %w", err)
			}
			return printOrganizationMembers(cmd.OutOrStdout(), result.Members)
		}},
		&cobra.Command{Use: "remove-member <id> <membership-id>", Short: "Remove an organization member", Args: exactArgsWithHelp(2), RunE: func(cmd *cobra.Command, args []string) error {
			_, err := executeOrganizationHTTP(o, http.MethodDelete, "/api/v1/organizations/"+url.PathEscape(args[0])+"/members/"+url.PathEscape(args[1]), nil)
			if err != nil {
				return fmt.Errorf("remove organization member: %w", err)
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Removed membership %s from organization %s.\n", args[1], args[0])
			return err
		}},
		&cobra.Command{Use: "leave <id>", Short: "Leave an organization", Args: exactArgsWithHelp(1), RunE: func(cmd *cobra.Command, args []string) error {
			response, err := executeOrganizationHTTP(o, http.MethodDelete, "/api/v1/organizations/"+url.PathEscape(args[0])+"/membership", nil)
			if err != nil {
				return fmt.Errorf("leave organization: %w", err)
			}
			var result struct {
				CurrentOrganizationID string `json:"currentOrganizationId"`
			}
			if err := json.Unmarshal(response, &result); err != nil {
				return fmt.Errorf("decode organization selection: %w", err)
			}
			if result.CurrentOrganizationID == "" {
				return fmt.Errorf("leave organization: server returned no current organization")
			}
			cfg, err := o.loadConfig()
			if err != nil {
				return err
			}
			cfg.OrganizationID = result.CurrentOrganizationID
			if err := config.Save(o.config, *cfg); err != nil {
				return err
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Left organization %s. Current organization: %s.\n", args[0], result.CurrentOrganizationID)
			return err
		}},
	)
	return organizationCmd
}
