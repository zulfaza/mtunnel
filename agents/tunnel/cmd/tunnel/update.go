package main

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/spf13/cobra"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/update"
)

func newUpdateCmd() *cobra.Command {
	var force bool
	command := &cobra.Command{Use: "update", Short: "Update to latest release", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		manifest, err := update.FetchManifest(cmd.Context(), http.DefaultClient, version, force)
		if err != nil {
			if errors.Is(err, update.ErrNotNewer) {
				fmt.Fprintf(cmd.OutOrStdout(), "already up to date (%s)\n", version)
				return nil
			}
			return fmt.Errorf("update: %w", err)
		}
		if err := update.Apply(cmd.Context(), http.DefaultClient, manifest); err != nil {
			return fmt.Errorf("update: %w", err)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "updated %s -> %s\n", version, manifest.Version)
		return nil
	}}
	command.Flags().BoolVar(&force, "force", false, "install even when release is not newer")
	return command
}
