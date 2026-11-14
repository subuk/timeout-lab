import { useSyncExternalStore } from "react";
import { I18n } from "./i18n.js";
export const t: (text: string) => string = I18n.t;
export const name = (value: { name?: string; id?: string; i18n?: unknown }) =>
  I18n.name(value);
export function useLocale() {
  return useSyncExternalStore(I18n.onChange, () => I18n.locale() || "en-US");
}
export const fmt = (value = 0, digits = 0) =>
  Number(value).toLocaleString(I18n.locale() || "en-US", {
    maximumFractionDigits: digits,
  });
export { I18n };
