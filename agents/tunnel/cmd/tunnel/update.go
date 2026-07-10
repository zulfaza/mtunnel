package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/spf13/cobra"
)

func newUpdateCmd() *cobra.Command {
	return &cobra.Command{Use: "update", Short: "Update to latest release", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
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
