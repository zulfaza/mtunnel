import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.js";

// A tunnel name that was claimed but never connected can be reclaimed by
// another organization after this long, so abandoned claims don't squat on a
// name forever.
const IDLE_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface DomainRecord {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly organizationId: string;
  readonly createdAt: number;
}

export class RegistryDO extends DurableObject<Env> {
  async organizationForTunnel(tunnelId: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`tunnel:${tunnelId}`)) ?? null;
  }

  async acquireConnection(
    tunnelId: string,
    organizationId: string,
    connectionId: string,
    maximum: number | null,
  ): Promise<boolean> {
    const key = `connections:${organizationId}`;
    const connections = (await this.ctx.storage.get<Record<string, string>>(key)) ?? {};
    if (
      !(tunnelId in connections) &&
      maximum !== null &&
      Object.keys(connections).length >= maximum
    ) {
      // Durable Object/WebSocket failures can prevent the close callback. Reconcile
      // only at the limit, keeping the common connect path to one storage operation.
      const statuses = await Promise.all(
        Object.keys(connections).map(async (connectedTunnelId) => ({
          connectedTunnelId,
          status: await this.env.TUNNELS.getByName(connectedTunnelId).status(connectedTunnelId),
        })),
      );
      for (const { connectedTunnelId, status } of statuses) {
        if (!status.connected) delete connections[connectedTunnelId];
      }
    }
    if (
      !(tunnelId in connections) &&
      maximum !== null &&
      Object.keys(connections).length >= maximum
    )
      return false;
    await this.ctx.storage.put(key, { ...connections, [tunnelId]: connectionId });
    return true;
  }

  async releaseConnection(
    tunnelId: string,
    organizationId: string,
    connectionId: string,
  ): Promise<void> {
    const key = `connections:${organizationId}`;
    const connections = (await this.ctx.storage.get<Record<string, string>>(key)) ?? {};
    if (connections[tunnelId] !== connectionId) return;
    delete connections[tunnelId];
    if (Object.keys(connections).length === 0) await this.ctx.storage.delete(key);
    else await this.ctx.storage.put(key, connections);
  }

  private async claimIsIdle(tunnelId: string, claimedAtKey: string): Promise<boolean> {
    const claimedAt = await this.ctx.storage.get<number>(claimedAtKey);
    if (claimedAt === undefined || Date.now() - claimedAt < IDLE_CLAIM_TTL_MS) return false;
    const status = await this.env.TUNNELS.getByName(tunnelId).status(tunnelId);
    return !status.connected && status.connectedAt === undefined;
  }

  async claimTunnel(
    tunnelId: string,
    organizationId: string,
    legacyUserId?: string,
  ): Promise<boolean> {
    const key = `tunnel:${tunnelId}`;
    const claimedAtKey = `tunnel-claimed-at:${tunnelId}`;
    const owner = await this.ctx.storage.get<string>(key);
    if (legacyUserId !== undefined && owner === legacyUserId) {
      await this.ctx.storage.put(key, organizationId);
      await this.ctx.storage.put(claimedAtKey, Date.now());
      return true;
    }
    if (owner !== undefined && owner !== organizationId) {
      if (!(await this.claimIsIdle(tunnelId, claimedAtKey))) return false;
    }
    if (owner === undefined || owner !== organizationId) {
      await this.ctx.storage.put(key, organizationId);
      await this.ctx.storage.put(claimedAtKey, Date.now());
    }
    return true;
  }

  async ownsTunnel(
    tunnelId: string,
    organizationId: string,
    legacyUserId?: string,
  ): Promise<boolean> {
    const key = `tunnel:${tunnelId}`;
    const owner = await this.ctx.storage.get<string>(key);
    if (legacyUserId !== undefined && owner === legacyUserId) {
      await this.ctx.storage.put(key, organizationId);
      return true;
    }
    return owner === organizationId;
  }

  async putDomain(record: DomainRecord): Promise<boolean> {
    if (!(await this.claimTunnel(record.tunnelId, record.organizationId))) return false;
    const key = `domain:${record.hostname}`;
    const current = await this.ctx.storage.get<DomainRecord>(key);
    if (current !== undefined && current.organizationId !== record.organizationId) return false;
    await this.ctx.storage.put(key, record);
    return true;
  }

  async getDomain(hostname: string): Promise<DomainRecord | null> {
    return (await this.ctx.storage.get<DomainRecord>(`domain:${hostname}`)) ?? null;
  }

  async deleteDomain(hostname: string, organizationId: string): Promise<DomainRecord | null> {
    const key = `domain:${hostname}`;
    const current = await this.ctx.storage.get<DomainRecord>(key);
    if (current === undefined || current.organizationId !== organizationId) return null;
    await this.ctx.storage.delete(key);
    return current;
  }
}
