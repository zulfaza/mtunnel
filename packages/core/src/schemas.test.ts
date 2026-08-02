import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AccessCode,
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
});
