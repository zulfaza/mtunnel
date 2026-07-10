package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/zul/ztunnel/agents/tunnel/internal/agent"
	"github.com/zul/ztunnel/agents/tunnel/internal/protocol"
)

func newHTTPCmd(o *rootOptions) *cobra.Command {
	return &cobra.Command{Use: "http <port>", Short: "Open an HTTP tunnel", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		port, err := parsePort(args[0])
		if err != nil {
			return err
		}
		cfg, err := o.loadConfig()
		if err != nil {
			return err
		}
		if cfg.Secret == "" {
			return fmt.Errorf("auth secret is required; run tunnel login or pass --token")
		}
		name := o.name
		if name == "" {
			name = randomName(8)
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		first := true
		return agent.Run(ctx, agent.Options{Server: cfg.Server, Secret: cfg.Secret, TunnelID: name, Hostname: o.hostname, Port: port, RequestTimeout: o.requestTimeout, Logger: o.logger, OnConnected: func(ack protocol.HelloAck, reconnected bool) {
			if first && !reconnected {
				fmt.Fprintf(cmd.OutOrStdout(), "Tunnel connected\n\nPublic URL:\n%s\n\nForwarding:\nhttp://127.0.0.1:%d\n", ack.PublicURL, port)
				first = false
			}
		}})
	}}
}

func parsePort(value string) (int, error) {
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("port must be a valid TCP port (1-65535)")
	}
	return port, nil
}

func randomName(length int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	var b strings.Builder
	b.Grow(length)
	for range length {
		n, err := rand.Int(rand.Reader, bigInt(int64(len(alphabet))))
		if err != nil {
			panic(err)
		}
		b.WriteByte(alphabet[n.Int64()])
	}
	return b.String()
}

func bigInt(n int64) *big.Int { return big.NewInt(n) }
