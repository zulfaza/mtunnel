import { useState, type FormEvent, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import { tunnelStatus } from "../server/tunnels.js";
import { SectionHeading, Shell } from "./shell.js";
import { OrganizationSwitcher } from "./organization-switcher.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";

export function TunnelsPage(): ReactNode {
  const [tunnelId, setTunnelId] = useState("");
  const [status, setStatus] = useState<Schemas.TunnelStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    void tunnelStatus({ data: { tunnelId } })
      .then(setStatus)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Request failed."),
      );
  };

  return (
    <Shell actions={<OrganizationSwitcher />}>
      <section className="flex-1 px-5 py-8 sm:px-8">
        <SectionHeading>Tunnels</SectionHeading>
        <h1 className="mt-4 text-2xl font-medium tracking-tight">Tunnel status</h1>
        <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
          Check connection state for a named tunnel.
        </p>
        <form className="mt-6 flex max-w-md items-end gap-3" onSubmit={lookup}>
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="tunnel-status-id">Tunnel name</Label>
            <Input
              id="tunnel-status-id"
              onChange={(event) => setTunnelId(event.target.value)}
              placeholder="my-app"
              required
              value={tunnelId}
            />
          </div>
          <Button type="submit" variant="primary">
            Check
          </Button>
        </form>
        {error !== null && <p className="mt-4 text-[13px] text-destructive">{error}</p>}
        {status !== null && (
          <div className="mt-6 max-w-md border border-border-soft bg-muted p-4 text-[13px] leading-7">
            <div>
              <span className="text-muted-foreground">tunnel </span>
              {status.tunnelId}
            </div>
            <div>
              <span className="text-muted-foreground">connected </span>
              {status.connected ? "yes" : "no"}
            </div>
            <div>
              <span className="text-muted-foreground">pending requests </span>
              {status.pendingRequests}
            </div>
            {status.connectedAt !== undefined && (
              <div>
                <span className="text-muted-foreground">connected at </span>
                {new Date(status.connectedAt).toISOString()}
              </div>
            )}
            {status.lastHeartbeatAt !== undefined && (
              <div>
                <span className="text-muted-foreground">last heartbeat </span>
                {new Date(status.lastHeartbeatAt).toISOString()}
              </div>
            )}
          </div>
        )}
      </section>
    </Shell>
  );
}
