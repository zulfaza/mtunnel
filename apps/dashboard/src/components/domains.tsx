import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Schemas } from "@tunnel/core";
import { addDomain, deleteDomain, refreshDomain, verifyDomain } from "../server/domains.js";
import { SectionHeading, Shell } from "./shell.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.js";

type Domain = Schemas.DomainView;

export function DomainsPage({
  initialDomains,
}: {
  readonly initialDomains: readonly Domain[];
}): ReactNode {
  const navigate = useNavigate();
  const [domains, setDomains] = useState(initialDomains);
  const [hostname, setHostname] = useState("");
  const [tunnelId, setTunnelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const failure = (cause: unknown): void => {
    if (cause instanceof Error && cause.message === "signed_out") {
      void navigate({ to: "/login" });
      return;
    }
    setError(cause instanceof Error ? cause.message : "Request failed.");
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void addDomain({ data: { hostname, tunnelId } })
      .then((result) => {
        setDomains((current) => [
          result.domain,
          ...current.filter((item) => item.hostname !== result.domain.hostname),
        ]);
        setHostname("");
        setTunnelId("");
      })
      .catch(failure)
      .finally(() => setBusy(false));
  };

  const verify = (domain: Domain): void => {
    setError(null);
    void verifyDomain({ data: { hostname: domain.hostname } })
      .then((result) => setDomains((current) => replaceDomain(current, result.domain)))
      .catch(failure);
  };

  const refresh = (domain: Domain): void => {
    void refreshDomain({ data: { hostname: domain.hostname } })
      .then((result) => setDomains((current) => replaceDomain(current, result.domain)))
      .catch(failure);
  };

  const remove = (domain: Domain): void => {
    if (!window.confirm(`Delete ${domain.hostname}? This cannot be undone.`)) return;
    void deleteDomain({ data: { hostname: domain.hostname } })
      .then(() =>
        setDomains((current) => current.filter((item) => item.hostname !== domain.hostname)),
      )
      .catch(failure);
  };

  return (
    <Shell>
      <section className="flex-1 px-5 py-8 sm:px-8">
        <SectionHeading>Domains</SectionHeading>
        <h1 className="mt-4 text-2xl font-medium tracking-tight">Custom domains</h1>
        <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
          Route a hostname to one of your named tunnels.
        </p>
        <form
          className="mt-6 grid max-w-2xl gap-3 border border-border-soft bg-muted p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={submit}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="hostname">Hostname</Label>
            <Input
              id="hostname"
              onChange={(event) => setHostname(event.target.value)}
              placeholder="app.example.com"
              required
              value={hostname}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tunnel-id">Tunnel name</Label>
            <Input
              id="tunnel-id"
              onChange={(event) => setTunnelId(event.target.value)}
              placeholder="my-app"
              required
              value={tunnelId}
            />
          </div>
          <Button disabled={busy} type="submit" variant="primary">
            {busy ? "Adding…" : "Add domain"}
          </Button>
        </form>
        {error !== null && <p className="mt-4 text-[13px] text-destructive">{error}</p>}
        <div className="mt-6">
          {domains.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No custom domains yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hostname</TableHead>
                  <TableHead>Tunnel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>DNS</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((domain) => (
                  <TableRow key={domain.hostname}>
                    <TableCell className="font-medium">{domain.hostname}</TableCell>
                    <TableCell className="text-muted-foreground">{domain.tunnelId}</TableCell>
                    <TableCell>{domain.status}</TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">
                      <div>CNAME {domain.cname.value}</div>
                      <div>
                        TXT {domain.verification.name} = {domain.verification.value}
                      </div>
                      {domain.error !== undefined && (
                        <div className="text-destructive">{domain.error}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {domain.status === "pending_dns" && (
                          <Button
                            onClick={() => verify(domain)}
                            size="icon"
                            title="Verify"
                            variant="ghost"
                          >
                            <RefreshCw />
                          </Button>
                        )}
                        {domain.status === "provisioning" && (
                          <Button
                            onClick={() => refresh(domain)}
                            size="icon"
                            title="Refresh"
                            variant="ghost"
                          >
                            <RefreshCw />
                          </Button>
                        )}
                        <Button
                          onClick={() => remove(domain)}
                          size="icon"
                          title="Delete"
                          variant="destructive"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </Shell>
  );
}

function replaceDomain(domains: readonly Domain[], replacement: Domain): readonly Domain[] {
  return domains.map((domain) => (domain.hostname === replacement.hostname ? replacement : domain));
}
