export function generateAccessCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const encoded = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return Array.from({ length: 8 }, (_, index) => encoded.slice(index * 4, index * 4 + 4)).join("-");
}
