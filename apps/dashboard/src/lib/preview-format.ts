import type { Schemas } from "@tunnel/core";

// Code-gated previews are opened through the owner-access route so a signed-in member
// is granted access without typing the access code.
export function previewHref(preview: Schemas.PreviewView): string {
  return preview.visibility === "code"
    ? `/preview-owner-access?return=${encodeURIComponent(preview.url)}`
    : preview.url;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
}

export function formatExpiry(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "expired";
  const hours = Math.round(remaining / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function formatUploadTime(createdAt: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(createdAt);
}
