import { describe, expect, it } from "vitest";
import { findTemplate, templates } from "./templates";

describe("asset templates", () => {
  it("has unique identifiers and valid dimensions", () => {
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);
    expect(templates.every((template) => template.width > 0 && template.height > 0)).toBe(true);
  });

  it("finds only registered templates", () => {
    expect(findTemplate("og")?.name).toBe("Landing OG");
    expect(findTemplate("missing")).toBeUndefined();
    expect(findTemplate(null)).toBeUndefined();
  });

  it("uses the correct domain for each product", () => {
    const landing = findTemplate("og");
    const dashboard = findTemplate("dashboard-og");

    expect(landing?.kind === "html" && landing.markup.includes(">makarima.xyz<")).toBe(true);
    expect(dashboard?.kind === "html" && dashboard.markup.includes(">app.makarima.xyz<")).toBe(
      true,
    );
  });
});
