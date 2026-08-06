import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  AccessCode,
  PreviewAccessView,
  PreviewCreateRequest,
  PreviewFile,
  PreviewVisibility,
  TunnelId,
  isValidHostname,
  isValidTunnelId,
} from "./schemas.js";

describe("core schemas", () => {
  it("validates tunnel ids and hostnames", () => {
    expect(isValidTunnelId("local-dev")).toBe(true);
    expect(isValidTunnelId("bad_name")).toBe(false);
    expect(isValidHostname("app.example.com")).toBe(true);
    expect(isValidHostname("localhost")).toBe(false);
  });

  it("keeps preview manifest constraints at the boundary", () => {
    expect(Schema.decodeUnknownSync(TunnelId)("local-dev")).toBe("local-dev");
    expect(Schema.decodeUnknownSync(PreviewVisibility)("private")).toBe("private");
    expect(Schema.decodeUnknownSync(AccessCode)("letmein-secure")).toBe("letmein-secure");
    expect(() => Schema.decodeUnknownSync(AccessCode)("no")).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PreviewFile)({
        path: "../secret",
        size: 1,
        contentType: "text/plain",
        sha256: "0".repeat(64),
      }),
    ).toThrow();
  });

  it("validates custom preview groups", () => {
    const request = {
      name: "report.html",
      group: "eod-report",
      files: [],
    };
    expect(Schema.decodeUnknownSync(PreviewCreateRequest)(request)).toEqual(request);
    expect(() =>
      Schema.decodeUnknownSync(PreviewCreateRequest)({ ...request, group: "" }),
    ).toThrow();
  });

  it("validates preview access management views", () => {
    expect(
      Schema.decodeUnknownSync(PreviewAccessView)({
        codes: [{ id: "code-id", createdAt: 1 }],
        sessions: [{ id: "session-id", createdAt: 2, expiresAt: 3 }],
      }),
    ).toEqual({
      codes: [{ id: "code-id", createdAt: 1 }],
      sessions: [{ id: "session-id", createdAt: 2, expiresAt: 3 }],
    });
  });
});
