package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/lmittmann/tint"
	"github.com/spf13/cobra"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/auth"
	"github.com/zulfaza/mtunnel/agents/tunnel/internal/config"
)

type rootOptions struct {
	server         string
	token          string
	config         string
	hostname       string
	name           string
	requestTimeout time.Duration
	idleTimeout    time.Duration
	logLevel       string
	logger         *slog.Logger
}

func newRootCmd() *cobra.Command {
	o := &rootOptions{config: config.DefaultPath()}
	cmd := &cobra.Command{
		Use:               "mt",
		Short:             "Expose a local HTTP server through mtunnel",
		SilenceErrors:     true,
		SilenceUsage:      true,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error { return o.configureLogger() },
	}
	flags := cmd.PersistentFlags()
	flags.StringVar(&o.server, "server", "", "override tunnel server URL")
	flags.StringVar(&o.token, "token", "", "override stored auth secret")
	flags.StringVar(&o.config, "config", o.config, "config file path")
	flags.StringVar(&o.hostname, "hostname", "localhost", "local upstream hostname")
	flags.StringVar(&o.name, "name", "", "tunnel name")
	flags.DurationVar(&o.requestTimeout, "request-timeout", 30*time.Second, "upstream request timeout")
	flags.DurationVar(&o.idleTimeout, "idle-timeout", 15*time.Minute, "close tunnel after this long without a request (0 disables)")
	flags.StringVar(&o.logLevel, "log-level", "info", "debug, info, warn, or error")
	cmd.AddCommand(newLoginCmd(o), newHTTPCmd(o), newStatusCmd(o), newDomainCmd(o), newUpdateCmd(), newVersionCmd())
	return cmd
}

func exactArgsWithHelp(count int) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if err := cobra.ExactArgs(count)(cmd, args); err != nil {
			if helpErr := cmd.Help(); helpErr != nil {
				return helpErr
			}
			return err
		}
		return nil
	}
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
	o.logger = slog.New(tint.NewHandler(os.Stderr, &tint.Options{
		Level:       level,
		TimeFormat:  time.TimeOnly,
		NoColor:     !isTerminal(os.Stderr),
		ReplaceAttr: colorHTTPStatus,
	}))
	return nil
}

func colorHTTPStatus(_ []string, attr slog.Attr) slog.Attr {
	if attr.Key != "status" {
		return attr
	}
	code, ok := httpStatusCode(attr.Value)
	if !ok {
		return attr
	}
	switch {
	case code >= 200 && code < 300:
		return tint.Attr(12, attr)
	case code >= 400 && code < 500:
		return tint.Attr(10, attr)
	case code >= 500 && code < 600:
		return tint.Attr(9, attr)
	default:
		return attr
	}
}

func httpStatusCode(value slog.Value) (int, bool) {
	switch value.Kind() {
	case slog.KindInt64:
		return int(value.Int64()), true
	case slog.KindString:
		text := value.String()
		if len(text) < 3 {
			return 0, false
		}
		code, err := strconv.Atoi(text[:3])
		return code, err == nil
	default:
		return 0, false
	}
}

func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
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
		cfg.RefreshToken = ""
	}
	if cfg.Server == "" {
		return config.Config{}, fmt.Errorf("server URL is required; run mt login or pass --server")
	}
	return cfg, nil
}

// doAuthenticated retries once with rotated credentials when a stored access
// token expires. The request factory makes retries safe for requests with bodies.
func (o *rootOptions) doAuthenticated(ctx context.Context, cfg config.Config, newRequest func(string) (*http.Request, error)) (*http.Response, error) {
	accessToken := cfg.AccessToken
	if accessToken == "" {
		accessToken = cfg.Secret
	}
	if accessToken == "" {
		return nil, fmt.Errorf("login required; run mt login")
	}
	send := func(token string) (*http.Response, error) {
		req, err := newRequest(token)
		if err != nil {
			return nil, err
		}
		return http.DefaultClient.Do(req)
	}
	resp, err := send(accessToken)
	if err != nil || resp.StatusCode != http.StatusUnauthorized || cfg.RefreshToken == "" || o.token != "" {
		return resp, err
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	credentials, err := auth.Refresh(ctx, http.DefaultClient, cfg.Server, cfg.RefreshToken)
	if err != nil {
		return nil, err
	}
	if err := config.Save(o.config, config.Config{Server: cfg.Server, AccessToken: credentials.AccessToken, RefreshToken: credentials.RefreshToken}); err != nil {
		return nil, err
	}
	return send(credentials.AccessToken)
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
