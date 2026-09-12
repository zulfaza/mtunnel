import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";
import { PreviewAccess } from "@tunnel/core";
import { cleanupExpiredPreviews } from "../src/routes/(api)/previews.js";

interface CreatedPreview {
  readonly id: string;
  readonly url: string;
}

async function createPreview(): Promise<CreatedPreview> {
  const response = await SELF.fetch("http://worker.test/api/v1/previews", {
    method: "POST",
    headers: { authorization: "Bearer development-token", "content-type": "application/json" },
    body: JSON.stringify({
      name: "site",
      files: [
        {
          path: "index.html",
          size: 5,
          contentType: "text/html",
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      ],
    }),
  });
  expect(response.status).toBe(201);
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("url" in value) ||
    typeof value.id !== "string" ||
    typeof value.url !== "string"
  )
    throw new Error("invalid preview response");
  return { id: value.id, url: value.url };
}

describe("previews", () => {
  it("rejects directory and multi-file manifests", async () => {
    const file = {
      path: "index.html",
      size: 5,
      contentType: "text/html",
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    };
    const create = async (files: readonly (typeof file)[]) =>
      SELF.fetch("http://worker.test/api/v1/previews", {
        method: "POST",
        headers: { authorization: "Bearer development-token", "content-type": "application/json" },
        body: JSON.stringify({ name: "site", files }),
      });
    const directory = await create([{ ...file, path: "site/index.html" }]);
    const multiple = await create([file, { ...file, path: "app.html" }]);
    expect(directory.status).toBe(400);
    expect(multiple.status).toBe(400);
  });

  it("versions previews for the same repository and name", async () => {
    const body = {
      name: "site.html",
      repoHost: "github.com",
      repoOrg: "acme",
      repoName: "site",
      files: [
        {
          path: "site.html",
          size: 5,
          contentType: "text/html",
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      ],
    };
    const create = async () =>
      SELF.fetch("http://worker.test/api/v1/previews", {
        method: "POST",
        headers: { authorization: "Bearer development-token", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const first = await create();
    const firstValue = (await first.json()) as { id: string; url: string; version: number };
    const second = await create();
    const secondValue = (await second.json()) as { id: string; url: string; version: number };
    expect(secondValue.id).not.toBe(firstValue.id);
    expect(firstValue.version).toBe(1);
    expect(secondValue.version).toBe(2);
    expect(secondValue.url).toBe(`https://preview.worker.test/${secondValue.id}`);
    const upload = await SELF.fetch(
      `http://worker.test/api/v1/previews/${secondValue.id}/files/site.html`,
      {
        method: "PUT",
        headers: { authorization: "Bearer development-token", "content-length": "5" },
        body: "hello",
      },
    );
    expect(upload.status).toBe(204);
    const stored = await env.PREVIEWS.get(`development-organization/site.html/${secondValue.id}`);
    expect(stored?.customMetadata).toEqual({ version: "2" });
  });

  it("groups custom previews while versioning each name independently", async () => {
    const create = async (name: string): Promise<unknown> => {
      const response = await SELF.fetch("http://worker.test/api/v1/previews", {
        method: "POST",
        headers: { authorization: "Bearer development-token", "content-type": "application/json" },
        body: JSON.stringify({
          name,
          group: "eod-report",
          files: [
            {
              path: "index.html",
              size: 5,
              contentType: "text/html",
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            },
          ],
        }),
      });
      expect(response.status).toBe(201);
      return response.json();
    };
    const first = await create("summary.html");
    const second = await create("details.html");
    const third = await create("summary.html");
    if (
      typeof first !== "object" ||
      first === null ||
      !("documentId" in first) ||
      !("version" in first) ||
      typeof second !== "object" ||
      second === null ||
      !("documentId" in second) ||
      !("version" in second) ||
      !("group" in second) ||
      typeof third !== "object" ||
      third === null ||
      !("documentId" in third) ||
      !("version" in third)
    )
      throw new Error("invalid preview response");
    expect(first.version).toBe(1);
    expect(second.version).toBe(1);
    expect(second.documentId).not.toBe(first.documentId);
    expect(second.group).toBe("eod-report");
    expect(third.version).toBe(2);
    expect(third.documentId).toBe(first.documentId);
  });

  it("redirects preview roots to the dashboard", async () => {
    const response = await SELF.fetch("http://preview.worker.test/", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.worker.test/");
  });

  it("uploads, serves ranges, and deletes a preview", async () => {
    const preview = await createPreview();
    const upload = await SELF.fetch(
      `http://worker.test/api/v1/previews/${preview.id}/files/index.html`,
      {
        method: "PUT",
        headers: { authorization: "Bearer development-token", "content-length": "5" },
        body: "hello",
      },
    );
    expect(upload.status).toBe(204);
    const stored = await env.PREVIEWS.get(`development-organization/site/${preview.id}`);
    expect(stored?.customMetadata).toEqual({ version: "1" });
    expect(await env.PREVIEWS.get(`${preview.id}/index.html`)).toBeNull();
    const served = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { range: "bytes=1-3" },
    });
    expect(served.status).toBe(206);
    expect(await served.text()).toBe("ell");
    expect(served.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(served.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const root = await SELF.fetch(`http://preview.worker.test/${preview.id}`);
    expect(root.status).toBe(200);
    expect(await root.text()).toBe("hello");
    const deleted = await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer development-token" },
    });
    expect(deleted.status).toBe(200);
    expect((await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`)).status).toBe(
      404,
    );
  });

  it("gates code-protected previews behind an access code", async () => {
    const created = await SELF.fetch("http://worker.test/api/v1/previews", {
      method: "POST",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({
        name: "gated",
        visibility: "code",
        accessCode: "open-sesame!",
        files: [
          {
            path: "index.html",
            size: 5,
            contentType: "text/html",
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const preview = (await created.json()) as {
      id: string;
      documentId: string;
      visibility: string;
    };
    expect(preview.visibility).toBe("code");
    expect(preview.documentId).toBe(preview.id);
    await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}/files/index.html`, {
      method: "PUT",
      headers: { authorization: "Bearer development-token", "content-length": "5" },
      body: "hello",
    });
    const gated = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`);
    expect(gated.status).toBe(401);
    expect(await gated.text()).toContain("Access code required");
    const unlocked = await SELF.fetch(
      `http://preview.worker.test/${preview.id}/index.html?code=open-sesame%21`,
      {
        redirect: "manual",
      },
    );
    expect(unlocked.status).toBe(303);
    expect(unlocked.headers.get("location")).toBe(
      `http://preview.worker.test/${preview.id}/index.html`,
    );
    expect(unlocked.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = unlocked.headers.get("set-cookie");
    expect(cookie).toContain("Max-Age=86400");
    const reuse = await SELF.fetch(
      `http://preview.worker.test/${preview.id}/index.html?code=open-sesame%21`,
      {
        redirect: "manual",
      },
    );
    expect(reuse.status).toBe(303);
    expect(reuse.headers.get("location")).toBe(
      `http://preview.worker.test/${preview.id}/index.html`,
    );
    expect(reuse.headers.get("set-cookie")).toContain("preview_access_session=");
    const reopened = await SELF.fetch(
      `http://preview.worker.test/${preview.id}/index.html?code=open-sesame%21`,
      {
        headers: { cookie: cookie?.split(";")[0] ?? "" },
        redirect: "manual",
      },
    );
    expect(reopened.status).toBe(303);
    expect(reopened.headers.get("location")).toBe(
      `http://preview.worker.test/${preview.id}/index.html`,
    );
    const served = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { cookie: cookie?.split(";")[0] ?? "" },
    });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("hello");
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    await env.DOMAINS.prepare(
      "UPDATE preview_access_grants SET expires_at = ? WHERE document_id = ?",
    )
      .bind(Date.now() - 1, preview.documentId)
      .run();
    const expired = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { cookie: cookie?.split(";")[0] ?? "" },
    });
    expect(expired.status).toBe(401);
  });

  it("bounces one gated navigation to the dashboard owner check", async () => {
    const created = await SELF.fetch("http://worker.test/api/v1/previews", {
      method: "POST",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({
        name: "owner-bounce",
        visibility: "code",
        accessCode: "open-sesame!",
        files: [
          {
            path: "index.html",
            size: 5,
            contentType: "text/html",
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          },
        ],
      }),
    });
    const preview = (await created.json()) as { id: string };
    await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}/files/index.html`, {
      method: "PUT",
      headers: { authorization: "Bearer development-token", "content-length": "5" },
      body: "hello",
    });
    const bounced = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { "sec-fetch-dest": "document" },
      redirect: "manual",
    });
    expect(bounced.status).toBe(303);
    expect(bounced.headers.get("location")).toBe(
      `https://app.worker.test/preview-owner-access?return=http%3A%2F%2Fpreview.worker.test%2F${preview.id}%2Findex.html`,
    );
    const probeCookie = bounced.headers.get("set-cookie") ?? "";
    expect(probeCookie).toContain(`preview_owner_probe=1; Path=/${preview.id}`);
    const gated = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { "sec-fetch-dest": "document", cookie: probeCookie.split(";")[0] ?? "" },
      redirect: "manual",
    });
    expect(gated.status).toBe(401);
    expect(await gated.text()).toContain("Access code required");
    const asset = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { "sec-fetch-dest": "image" },
      redirect: "manual",
    });
    expect(asset.status).toBe(401);
  });

  it("allows an owner ticket without consuming the access code", async () => {
    const created = await SELF.fetch("http://worker.test/api/v1/previews", {
      method: "POST",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({
        name: "owner-gated",
        visibility: "code",
        accessCode: "open-sesame!",
        files: [
          {
            path: "index.html",
            size: 5,
            contentType: "text/html",
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          },
        ],
      }),
    });
    const preview = (await created.json()) as { id: string; documentId: string };
    await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}/files/index.html`, {
      method: "PUT",
      headers: { authorization: "Bearer development-token", "content-length": "5" },
      body: "hello",
    });
    if (env.AUTH_SECRET === undefined) throw new Error("AUTH_SECRET is not configured");
    const owner = await env.DOMAINS.prepare("SELECT organization_id FROM previews WHERE id = ?")
      .bind(preview.id)
      .first<{ organization_id: string }>();
    if (owner === null) throw new Error("preview row is missing");
    const ticketFor = (organizationId: string) =>
      PreviewAccess.previewOwnerTicket(env.AUTH_SECRET ?? "", {
        previewId: preview.id,
        organizationId,
        expiresAt: Date.now() + PreviewAccess.PREVIEW_OWNER_TICKET_TTL_MS,
      });
    const expiredTicket = await PreviewAccess.previewOwnerTicket(env.AUTH_SECRET, {
      previewId: preview.id,
      organizationId: owner.organization_id,
      expiresAt: Date.now() - 1,
    });
    const validTicket = await ticketFor(owner.organization_id);
    for (const ticket of [await ticketFor("org_other"), expiredTicket, `${validTicket}x`]) {
      const rejected = await SELF.fetch(
        `http://preview.worker.test/${preview.id}/index.html?owner_ticket=${encodeURIComponent(ticket)}`,
        { redirect: "manual" },
      );
      expect(rejected.status).toBe(303);
      expect(rejected.headers.get("location")).toBe(
        `http://preview.worker.test/${preview.id}/index.html`,
      );
      expect(rejected.headers.get("set-cookie")).toContain("preview_owner_probe=1");
    }
    const authorized = await SELF.fetch(
      `http://preview.worker.test/${preview.id}/index.html?owner_ticket=${encodeURIComponent(validTicket)}`,
      { redirect: "manual" },
    );
    expect(authorized.status).toBe(303);
    expect(authorized.headers.get("location")).toBe(
      `http://preview.worker.test/${preview.id}/index.html`,
    );
    const cookie = authorized.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("preview_access_session=");
    const served = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { cookie },
    });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("hello");
    expect(served.headers.get("referrer-policy")).toBe("no-referrer");
    const accessCode = await env.DOMAINS.prepare(
      "SELECT used_at, revoked_at FROM preview_access_codes WHERE document_id = ?",
    )
      .bind(preview.documentId)
      .first<{ used_at: number | null; revoked_at: number | null }>();
    expect(accessCode?.used_at).toBeNull();
    expect(accessCode?.revoked_at).toBeNull();
  });

  it("shares a document grant across preview versions", async () => {
    const create = (accessCode: string) =>
      SELF.fetch("http://worker.test/api/v1/previews", {
        method: "POST",
        headers: { authorization: "Bearer development-token", "content-type": "application/json" },
        body: JSON.stringify({
          name: "versioned-gate",
          repoHost: "github.com",
          repoOrg: "acme",
          repoName: "versioned-gate",
          visibility: "code",
          accessCode,
          files: [
            {
              path: "index.html",
              size: 5,
              contentType: "text/html",
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            },
          ],
        }),
      });
    const firstResponse = await create("first-device-code");
    const first = (await firstResponse.json()) as { id: string; documentId: string };
    const unlocked = await SELF.fetch(
      `http://preview.worker.test/${first.id}/index.html?code=first-device-code`,
      { redirect: "manual" },
    );
    const cookie = unlocked.headers.get("set-cookie")?.split(";")[0] ?? "";
    const secondResponse = await create("second-device-code");
    const second = (await secondResponse.json()) as { id: string; documentId: string };
    expect(second.documentId).toBe(first.documentId);
    const uploaded = await SELF.fetch(
      `http://worker.test/api/v1/previews/${second.id}/files/index.html`,
      {
        method: "PUT",
        headers: { authorization: "Bearer development-token", "content-length": "5" },
        body: "hello",
      },
    );
    expect(uploaded.status).toBe(204);
    const served = await SELF.fetch(`http://preview.worker.test/${second.id}/index.html`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(served.status).toBe(200);
  });

  it("updates preview visibility", async () => {
    const preview = await createPreview();
    const version = await createPreview();
    const updated = await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}`, {
      method: "PATCH",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { visibility: string }).visibility).toBe("private");
    const blocked = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`);
    expect(blocked.status).toBe(403);
    const blockedVersion = await SELF.fetch(`http://preview.worker.test/${version.id}/index.html`);
    expect(blockedVersion.status).toBe(403);
    const invalid = await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}`, {
      method: "PATCH",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({ visibility: "code" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("removes expired preview rows and objects", async () => {
    const id = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    await env.DOMAINS.prepare(
      "INSERT INTO previews (id, organization_id, user_id, name, manifest, total_bytes, file_count, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, "org", "user", "old", "[]", 1, 1, Date.now() - 2_000, Date.now() - 1_000)
      .run();
    await env.PREVIEWS.put(`org/old/${id}`, "old");
    await env.PREVIEWS.put(`org/old/${id}/file.txt`, "nested");
    await env.PREVIEWS.put(`${id}/legacy.txt`, "legacy");
    await cleanupExpiredPreviews(env);
    expect(await env.PREVIEWS.get(`org/old/${id}`)).toBeNull();
    expect(await env.PREVIEWS.get(`org/old/${id}/file.txt`)).toBeNull();
    expect(await env.PREVIEWS.get(`${id}/legacy.txt`)).toBeNull();
    expect(
      await env.DOMAINS.prepare("SELECT id FROM previews WHERE id = ?").bind(id).first(),
    ).toBeNull();
  });
});
