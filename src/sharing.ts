import type { Config } from "./model";

// Bound allocation before decoding links pasted from outside the application.
const maxBytes = 128 * 1024;
export function modelFromHash(hash: string): Config | null {
  if (hash.length > maxBytes * 2) throw Error("Model link is too large.");
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has("model")) return null;
  const value = params.get("model")!;
  if (value.length > Math.ceil((maxBytes * 4) / 3))
    throw Error("Model link is too large.");
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const bytes = Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const config = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw Error();
    return config as Config; // The Go engine validates the complete model.
  } catch {
    throw Error("Invalid model link. Ask the author for a new link.");
  }
}

export function modelURL(config: Config, base = location.href): string {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  if (bytes.length > maxBytes) throw Error("Model link is too large.");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const url = new URL(base);
  url.hash =
    "model=" +
    btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return url.href;
}
