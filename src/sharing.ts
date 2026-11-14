import type { Config } from "./model";
import { DiagnosticError, errorDetails } from "./errors";

// Bound allocation before decoding links pasted from outside the application.
const maxBytes = 128 * 1024;
function tooLarge(actual: number, limit: number, unit: string): never {
  throw new DiagnosticError(
    "Model link is too large.",
    `${actual} ${unit}; maximum: ${limit} ${unit}. JSON limit: ${maxBytes} bytes (128 KiB).`,
  );
}
export function modelFromHash(hash: string): Config | null {
  if (hash.length > maxBytes * 2)
    tooLarge(hash.length, maxBytes * 2, "URL fragment characters");
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has("model")) return null;
  const value = params.get("model")!;
  if (value.length > Math.ceil((maxBytes * 4) / 3))
    tooLarge(
      value.length,
      Math.ceil((maxBytes * 4) / 3),
      "base64url characters",
    );
  if (!value)
    throw new DiagnosticError(
      "The model link contains no model data.",
      "The #model parameter is empty.",
    );
  const invalid = value.search(/[^A-Za-z0-9_-]/);
  if (invalid !== -1)
    throw new DiagnosticError(
      "The model link contains an invalid base64url character.",
      `Character ${JSON.stringify(value[invalid])} at position ${invalid + 1}. Expected A–Z, a–z, 0–9, '-' or '_', without '=' padding.`,
    );
  if (value.length % 4 === 1)
    throw new DiagnosticError(
      "The model link has an invalid base64url length. It may be truncated.",
      `${value.length} base64url characters; length modulo 4 must be 0, 2 or 3, but is 1.`,
    );
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
  } catch (error) {
    throw new DiagnosticError(
      "The model link could not be decoded as base64url.",
      errorDetails(error),
    );
  }
  if (bytes.length > maxBytes) tooLarge(bytes.length, maxBytes, "JSON bytes");
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new DiagnosticError(
      "The model link contains invalid UTF-8 text.",
      errorDetails(error),
    );
  }
  let config: unknown;
  try {
    config = JSON.parse(json);
  } catch (error) {
    throw new DiagnosticError(
      "The model link contains invalid JSON.",
      errorDetails(error),
    );
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new DiagnosticError(
      "The model must be a JSON object.",
      `Expected an object, received ${config === null ? "null" : Array.isArray(config) ? "an array" : typeof config}.`,
    );
  return config as Config; // The Go engine validates the complete model.
}

export function modelURL(config: Config, base = location.href): string {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  if (bytes.length > maxBytes) tooLarge(bytes.length, maxBytes, "JSON bytes");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const url = new URL(base);
  url.hash =
    "model=" +
    btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return url.href;
}
