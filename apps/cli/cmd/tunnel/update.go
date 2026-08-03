package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/zulfaza/mtunnel/apps/cli/internal/update"
)

func newUpdateCmd() *cobra.Command {
	return &cobra.Command{Use: "update", Short: "Update to latest release", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		return runUpdate(cmd.Context(), cmd.OutOrStdout(), version, func(ctx context.Context) (string, error) {
			return update.Latest(ctx, http.DefaultClient)
		}, installLatest)
	}}
}

type latestVersion func(context.Context) (string, error)
type installVersion func(context.Context) error

func runUpdate(ctx context.Context, output io.Writer, current string, latest latestVersion, install installVersion) error {
	target, err := latest(ctx)
	if err != nil {
		return fmt.Errorf("check latest version: %w", err)
	}
	if current != "dev" && !update.IsNewer(current, target) {
		fmt.Fprintf(output, "already up to date (%s)\n", current)
		return nil
	}

	progress := startUpdateProgress(output, current, target)
	if err := install(ctx); err != nil {
		progress.stop(false)
		return fmt.Errorf("update: %w", err)
	}
	progress.stop(true)
	return nil
}

func installLatest(ctx context.Context) error {
	installer := exec.CommandContext(ctx, "sh", "-c", "curl -fsSL https://makarima.xyz/install.sh | sh")
	installer.Stdin = os.Stdin
	output, err := installer.CombinedOutput()
	if err == nil {
		return nil
	}
	detail := strings.TrimSpace(string(output))
	if detail == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, detail)
}

type updateProgress struct {
	output  io.Writer
	current string
	target  string
	done    chan struct{}
	stopped chan struct{}
}

func startUpdateProgress(output io.Writer, current, target string) updateProgress {
	progress := updateProgress{output: output, current: current, target: target}
	message := fmt.Sprintf("Updating mt from %s to %s...", current, target)
	if !isTerminalWriter(output) {
		fmt.Fprintln(output, message)
		return progress
	}

	progress.done = make(chan struct{})
	progress.stopped = make(chan struct{})
	go func() {
		defer close(progress.stopped)
		frames := [...]string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
		ticker := time.NewTicker(80 * time.Millisecond)
		defer ticker.Stop()
		for frame := 0; ; frame = (frame + 1) % len(frames) {
			fmt.Fprintf(output, "\r%s %s", frames[frame], message)
			select {
			case <-progress.done:
				return
			case <-ticker.C:
			}
		}
	}()
	return progress
}

func (progress updateProgress) stop(succeeded bool) {
	if progress.done != nil {
		close(progress.done)
		<-progress.stopped
		fmt.Fprint(progress.output, "\r\x1b[2K")
	}
	if succeeded {
		fmt.Fprintf(progress.output, "✓ Updated mt from %s to %s successfully.\n", progress.current, progress.target)
		return
	}
	if progress.done != nil {
		fmt.Fprintf(progress.output, "✗ Update failed from %s to %s.\n", progress.current, progress.target)
		return
	}
	// Non-interactive output already records the attempted version transition.
	fmt.Fprintln(progress.output, "Update failed.")
}

func isTerminalWriter(writer io.Writer) bool {
	switch file := writer.(type) {
	case *os.File:
		return isTerminal(file)
	default:
		return false
	}
}
