import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.js";

interface DomainRecord {
  readonly hostname: string;
  readonly tunnelId: string;
  readonly organizationId: string;
  readonly createdAt: number;
}

export class RegistryDO extends DurableObject<Env> {
  async claimTunnel(
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
    if (owner !== undefined && owner !== organizationId) return false;
    if (owner === undefined) await this.ctx.storage.put(key, organizationId);
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
