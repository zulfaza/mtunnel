import { describe, expect, it } from "vitest";
import { MAX_FRAME_PAYLOAD_BYTES, chunkPayload } from "../src/index.js";

describe("chunkPayload", () => {
  it("returns an empty array for empty input", () => {
    expect(chunkPayload(new Uint8Array(0))).toEqual([]);
  });

  it("returns a single chunk for input smaller than max", () => {
    const data = new Uint8Array([1, 2, 3]);
    const chunks = chunkPayload(data, 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(data);
  });

  it("splits input that is an exact multiple of max", () => {
    const data = Uint8Array.from({ length: 10 }, (_, i) => i);
    const chunks = chunkPayload(data, 5);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual(data.slice(0, 5));
    expect(chunks[1]).toEqual(data.slice(5, 10));
  });

  it("splits input with a remainder", () => {
    const data = Uint8Array.from({ length: 11 }, (_, i) => i);
    const chunks = chunkPayload(data, 5);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(5);
    expect(chunks[1]).toHaveLength(5);
    expect(chunks[2]).toHaveLength(1);
    expect(chunks[2]).toEqual(new Uint8Array([10]));
  });

  it("defaults to MAX_FRAME_PAYLOAD_BYTES", () => {
    const data = new Uint8Array(MAX_FRAME_PAYLOAD_BYTES + 1);
    const chunks = chunkPayload(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MAX_FRAME_PAYLOAD_BYTES);
    expect(chunks[1]).toHaveLength(1);
  });

  it("never produces a chunk larger than max", () => {
    const data = new Uint8Array(1000);
    for (const chunk of chunkPayload(data, 257)) {
      expect(chunk.length).toBeLessThanOrEqual(257);
    }
  });

  it("throws for a non-positive max", () => {
    expect(() => chunkPayload(new Uint8Array(1), 0)).toThrow(RangeError);
  });
});
