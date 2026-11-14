import { t } from "./locale";

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equal(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  );
}
// Apply only edits made since opening the form. Live scaling and unrelated
// changes survive; a concurrent edit to the same field requires review.
export function mergeDraft<T>(base: T, draft: T, live: T, path = "Model"): T {
  if (equal(base, draft)) return structuredClone(live);
  if (equal(base, live) || equal(draft, live)) return structuredClone(draft);
  if (Array.isArray(base) && Array.isArray(draft) && Array.isArray(live)) {
    const identity = (value: unknown) =>
      value && typeof value === "object" && "id" in value
        ? value.id
        : undefined;
    if (
      base.length === draft.length &&
      base.length === live.length &&
      base.every(
        (value, i) =>
          identity(value) === identity(draft[i]) &&
          identity(value) === identity(live[i]),
      )
    )
      return base.map((value, i) =>
        mergeDraft(value, draft[i], live[i], `${path}.${i}`),
      ) as T;
  } else if (
    base &&
    draft &&
    live &&
    typeof base === "object" &&
    typeof draft === "object" &&
    typeof live === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(draft) &&
    !Array.isArray(live)
  ) {
    const b = base as Record<string, unknown>,
      d = draft as Record<string, unknown>,
      l = live as Record<string, unknown>;
    const next = { ...l };
    for (const key of new Set([...Object.keys(b), ...Object.keys(d)])) {
      const value = mergeDraft(b[key], d[key], l[key], `${path}.${key}`);
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    return next as T;
  }
  throw new Error(
    `${t("This setting changed while the editor was open. Reopen the editor and review it.")} (${path})`,
  );
}
