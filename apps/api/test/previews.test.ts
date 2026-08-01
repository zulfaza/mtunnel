import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
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
    const served = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { range: "bytes=1-3" },
    });
    expect(served.status).toBe(206);
    expect(await served.text()).toBe("ell");
    expect(served.headers.get("content-range")).toBe("bytes 1-3/5");
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
        accessCode: "open-sesame",
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
    const preview = (await created.json()) as { id: string; visibility: string };
    expect(preview.visibility).toBe("code");
    await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}/files/index.html`, {
      method: "PUT",
      headers: { authorization: "Bearer development-token", "content-length": "5" },
      body: "hello",
    });
    const gated = await SELF.fetch(`http://preview.worker.test/${preview.id}/`);
    expect(gated.status).toBe(401);
    expect(await gated.text()).toContain("Access code required");
    const rejected = await SELF.fetch(`http://preview.worker.test/${preview.id}/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "code=wrong-code",
    });
    expect(rejected.status).toBe(401);
    const unlocked = await SELF.fetch(`http://preview.worker.test/${preview.id}/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "code=open-sesame",
      redirect: "manual",
    });
    expect(unlocked.status).toBe(303);
    const cookie = unlocked.headers.get("set-cookie");
    expect(cookie).not.toBeNull();
    const served = await SELF.fetch(`http://preview.worker.test/${preview.id}/index.html`, {
      headers: { cookie: cookie?.split(";")[0] ?? "" },
    });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("hello");
    expect(served.headers.get("cache-control")).toBe("private, no-store");
  });

  it("updates preview visibility", async () => {
    const preview = await createPreview();
    const updated = await SELF.fetch(`http://worker.test/api/v1/previews/${preview.id}`, {
      method: "PATCH",
      headers: { authorization: "Bearer development-token", "content-type": "application/json" },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { visibility: string }).visibility).toBe("private");
    const blocked = await SELF.fetch(`http://preview.worker.test/${preview.id}/`);
    expect(blocked.status).toBe(403);
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
    await env.PREVIEWS.put(`${id}/file.txt`, "old");
    await cleanupExpiredPreviews(env);
    expect(await env.PREVIEWS.get(`${id}/file.txt`)).toBeNull();
    expect(
      await env.DOMAINS.prepare("SELECT id FROM previews WHERE id = ?").bind(id).first(),
    ).toBeNull();
  });
});
