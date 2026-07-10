// Package agent wires the connection lifecycle to the local HTTP proxy.
package agent

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/zul/ztunnel/agents/tunnel/internal/client"
	"github.com/zul/ztunnel/agents/tunnel/internal/protocol"
	"github.com/zul/ztunnel/agents/tunnel/internal/proxy"
)

type Options struct {
	Server         string
	Secret         string
	TunnelID       string
	Hostname       string
	Port           int
	RequestTimeout time.Duration
	Logger         *slog.Logger
	HTTPClient     *http.Client
	InitialBackoff time.Duration
	OnConnected    func(protocol.HelloAck, bool)
}

func Run(ctx context.Context, opts Options) error {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.Port < 1 || opts.Port > 65535 {
		return fmt.Errorf("invalid upstream port")
	}
	upstream := fmt.Sprintf("http://%s:%d", opts.Hostname, opts.Port)
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Transport: &http.Transport{DisableCompression: true, Proxy: http.ProxyFromEnvironment}}
	}
	var mu sync.RWMutex
	var current *proxy.Dispatcher
	connected := false
	onMessage := func(message protocol.Message) {
		mu.RLock()
		d := current
		mu.RUnlock()
		if d == nil {
			return
		}
		switch m := message.(type) {
		case protocol.RequestStart:
			d.Start(m)
		case protocol.RequestBody:
			d.Body(m)
		case protocol.RequestEnd:
			d.End(m)
		case protocol.Cancel:
			d.Cancel(m)
		default:
			opts.Logger.Debug("unexpected tunnel message", "type", fmt.Sprintf("%T", message))
		}
	}
	onOpen := func(connCtx context.Context, ack protocol.HelloAck, send client.SendFunc) func() {
		d := proxy.New(proxy.Options{BaseContext: connCtx, Upstream: upstream, Timeout: opts.RequestTimeout, TunnelID: opts.TunnelID, Logger: opts.Logger, Send: proxy.SendFunc(send), HTTPClient: httpClient})
		mu.Lock()
		current = d
		wasConnected := connected
		connected = true
		mu.Unlock()
		if wasConnected {
			opts.Logger.Info("reconnected", "tunnelId", opts.TunnelID, "publicUrl", ack.PublicURL)
		}
		if opts.OnConnected != nil {
			opts.OnConnected(ack, wasConnected)
		}
		return func() {
			d.Shutdown(5 * time.Second)
			mu.Lock()
			if current == d {
				current = nil
			}
			mu.Unlock()
		}
	}
	err := client.Run(ctx, client.Options{Server: opts.Server, Secret: opts.Secret, TunnelID: opts.TunnelID, AgentVersion: "dev", HTTPClient: httpClient, Logger: opts.Logger, InitialBackoff: opts.InitialBackoff, OnOpen: onOpen, OnMessage: onMessage})
	if err == client.ErrReplaced {
		opts.Logger.Warn("tunnel replaced by a newer agent", "tunnelId", opts.TunnelID)
	}
	return err
}
