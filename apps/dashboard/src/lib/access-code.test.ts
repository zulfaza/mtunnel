import { describe, expect, it } from "vite-plus/test";
import { generateAccessCode } from "./access-code.js";

describe("preview access codes", () => {
  it("generates 128-bit codes in copyable groups", () => {
    const codes = Array.from({ length: 10 }, generateAccessCode);

    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-f0-9]{4}(?:-[a-f0-9]{4}){7}$/u);
  });
});
