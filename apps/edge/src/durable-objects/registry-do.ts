import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.js";

interface DomainRecord {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly ownerId: string;
  readonly createdAt: number;
}

export class RegistryDO extends DurableObject<Env> {
  async claimTunnel(tunnelId: string, ownerId: string): Promise<boolean> {
    const key = `tunnel:${tunnelId}`;
    const owner = await this.ctx.storage.get<string>(key);
    if (owner !== undefined && owner !== ownerId) return false;
    if (owner === undefined) await this.ctx.storage.put(key, ownerId);
    return true;
  }

  async ownsTunnel(tunnelId: string, ownerId: string): Promise<boolean> {
    return (await this.ctx.storage.get<string>(`tunnel:${tunnelId}`)) === ownerId;
  }

  async putDomain(record: DomainRecord): Promise<boolean> {
    if (!(await this.claimTunnel(record.tunnelId, record.ownerId))) return false;
    const key = `domain:${record.hostname}`;
    const current = await this.ctx.storage.get<DomainRecord>(key);
    if (current !== undefined && current.ownerId !== record.ownerId) return false;
    await this.ctx.storage.put(key, record);
    return true;
  }

  async getDomain(hostname: string): Promise<DomainRecord | null> {
    return (await this.ctx.storage.get<DomainRecord>(`domain:${hostname}`)) ?? null;
  }

  async deleteDomain(hostname: string, ownerId: string): Promise<DomainRecord | null> {
    const key = `domain:${hostname}`;
    const current = await this.ctx.storage.get<DomainRecord>(key);
    if (current === undefined || current.ownerId !== ownerId) return null;
    await this.ctx.storage.delete(key);
    return current;
  }
}
