import { describe, expect, it } from "vitest";
import { hexToRequestId, newRequestId, requestIdEquals, requestIdToHex } from "../src/index.js";

describe("request id helpers", () => {
  it("newRequestId generates 16 random bytes", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toHaveLength(16);
    expect(b).toHaveLength(16);
    expect(requestIdEquals(a, b)).toBe(false);
  });

  it("requestIdToHex / hexToRequestId round-trip", () => {
    const id = newRequestId();
    const hex = requestIdToHex(id);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
    expect(hexToRequestId(hex)).toEqual(id);
  });

  it("requestIdToHex produces the expected lowercase hex", () => {
    const id = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(requestIdToHex(id)).toBe("000102030405060708090a0b0c0d0e0f");
  });

  it("hexToRequestId rejects the wrong length", () => {
    expect(() => hexToRequestId("abcd")).toThrow(RangeError);
  });

  it("hexToRequestId rejects invalid hex characters", () => {
    expect(() => hexToRequestId("zz".repeat(16))).toThrow(RangeError);
  });

  it("requestIdEquals compares byte-for-byte", () => {
    const a = Uint8Array.from({ length: 16 }, () => 1);
    const b = Uint8Array.from({ length: 16 }, () => 1);
    const c = Uint8Array.from({ length: 16 }, () => 2);
    expect(requestIdEquals(a, b)).toBe(true);
    expect(requestIdEquals(a, c)).toBe(false);
  });

  it("requestIdEquals returns false for different lengths", () => {
    expect(requestIdEquals(new Uint8Array(16), new Uint8Array(4))).toBe(false);
  });
});
