package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"

	"github.com/spf13/cobra"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/update"
)

func newUpdateCmd() *cobra.Command {
	return &cobra.Command{Use: "update", Short: "Update to latest release", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		if version != "dev" {
			latest, err := update.Latest(cmd.Context(), http.DefaultClient)
			if err == nil && !update.IsNewer(version, latest) {
				fmt.Fprintf(cmd.OutOrStdout(), "already up to date (%s)\n", version)
				return nil
			}
		}
		installer := exec.CommandContext(cmd.Context(), "sh", "-c", "curl -fsSL https://makarima.xyz/install.sh | sh")
		installer.Stdout = cmd.OutOrStdout()
		installer.Stderr = cmd.ErrOrStderr()
		installer.Stdin = os.Stdin
		if err := installer.Run(); err != nil {
			return fmt.Errorf("update: %w", err)
		}
		return nil
	}}
}
