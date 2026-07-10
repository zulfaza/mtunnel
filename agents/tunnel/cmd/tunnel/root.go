package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/zul/ztunnel/agents/tunnel/internal/config"
)

type rootOptions struct {
	server         string
	token          string
	config         string
	hostname       string
	name           string
	requestTimeout time.Duration
	logLevel       string
	logger         *slog.Logger
}

func newRootCmd() *cobra.Command {
	o := &rootOptions{config: config.DefaultPath()}
	cmd := &cobra.Command{
		Use:               "tunnel",
		Short:             "Expose a local HTTP server through ztunnel",
		SilenceUsage:      true,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error { return o.configureLogger() },
	}
	flags := cmd.PersistentFlags()
	flags.StringVar(&o.server, "server", "", "override tunnel server URL")
	flags.StringVar(&o.token, "token", "", "override stored auth secret")
	flags.StringVar(&o.config, "config", o.config, "config file path")
	flags.StringVar(&o.hostname, "hostname", "127.0.0.1", "local upstream hostname")
	flags.StringVar(&o.name, "name", "", "tunnel name")
	flags.DurationVar(&o.requestTimeout, "request-timeout", 30*time.Second, "upstream request timeout")
	flags.StringVar(&o.logLevel, "log-level", "info", "debug, info, warn, or error")
	cmd.AddCommand(newLoginCmd(o), newHTTPCmd(o), newStatusCmd(o), newDomainCmd(o), newUpdateCmd(), newVersionCmd())
	return cmd
}

func (o *rootOptions) configureLogger() error {
	var level slog.Level
	switch o.logLevel {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		return fmt.Errorf("invalid log level %q (want debug, info, warn, or error)", o.logLevel)
	}
	o.logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))
	return nil
}

func (o *rootOptions) loadConfig() (config.Config, error) {
	cfg, err := config.Load(o.config)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return config.Config{}, err
		}
		cfg = config.Config{}
	}
	if o.server != "" {
		cfg.Server = o.server
	}
	if o.token != "" {
		cfg.AccessToken = o.token
	}
	if cfg.Server == "" {
		return config.Config{}, fmt.Errorf("server URL is required; run tunnel login or pass --server")
	}
	return cfg, nil
}

func prompt(out io.Writer, in io.Reader, label string) (string, error) {
	if _, err := fmt.Fprintf(out, "%s: ", label); err != nil {
		return "", err
	}
	var value string
	if _, err := fmt.Fscanln(in, &value); err != nil {
		return "", fmt.Errorf("read %s: %w", label, err)
	}
	return value, nil
}
