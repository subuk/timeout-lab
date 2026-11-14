import { useSyncExternalStore } from "react";
import type { Config, Snapshot, RequestOptions } from "./model";
export type Command =
  | { type: "snapshot" | "pause" }
  | { type: "step" | "advance"; ms?: number }
  | { type: "speed"; value: number }
  | { type: "mode"; manual: boolean }
  | { type: "request"; request: RequestOptions }
  | { type: "preset"; preset: string }
  | { type: "reset" | "config"; config: Config }
  | {
      type: "node";
      id: string;
      state?: string;
      service?: number;
      workers?: number;
    };
export type Reply =
  | {
      type: "snapshot";
      data: Snapshot;
      paused: boolean;
      speed: number;
      requestId?: number;
    }
  | { type: "error"; message: string; requestId?: number };
export interface EngineState {
  snapshot: Snapshot | null;
  paused: boolean;
  speed: number;
  error: string;
  epoch: number;
}
let current: EngineState = {
  snapshot: null,
  paused: false,
  speed: 1,
  error: "",
  epoch: 0,
};
const listeners = new Set<() => void>();
let worker: Worker | undefined;
let sequence = 0;
let configJSON = "";
const pending = new Map<
  number,
  { resolve: () => void; reject: (e: Error) => void; reset: boolean }
>();
function publish(next: EngineState) {
  current = next;
  listeners.forEach((fn) => fn());
}
export function startEngine() {
  if (worker) return;
  worker = new Worker(
    window.LAB_WORKER_URL ||
      new URL(/* @vite-ignore */ "../worker.js", import.meta.url),
  );
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    const request =
      data.requestId === undefined ? undefined : pending.get(data.requestId);
    if (data.requestId !== undefined) pending.delete(data.requestId);
    if (data.type === "error") {
      publish({ ...current, error: data.message });
      request?.reject(new Error(data.message));
      return;
    }
    const serialized = JSON.stringify(data.data.config);
    if (serialized === configJSON && current.snapshot)
      data.data.config = current.snapshot.config;
    configJSON = serialized;
    publish({
      snapshot: data.data,
      paused: data.paused,
      speed: data.speed,
      error: request ? "" : current.error,
      epoch: current.epoch + (request?.reset ? 1 : 0),
    });
    request?.resolve();
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Engine startup error");
    publish({ ...current, error: error.message });
    pending.forEach((p) => p.reject(error));
    pending.clear();
  };
}
export function command(cmd: Command): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!worker || !current.snapshot) {
      reject(new Error("Loading engine…"));
      return;
    }
    const requestId = ++sequence;
    pending.set(requestId, {
      resolve,
      reject,
      reset: cmd.type === "reset" || cmd.type === "preset",
    });
    worker.postMessage({ ...cmd, requestId });
  });
}
// Resolve edits against the latest accepted configuration, including autoscaling.
let editQueue: Promise<void> = Promise.resolve();
export function editConfig(mutate: (c: Config) => void, reset = false) {
  const result = editQueue.then(() => {
    if (!current.snapshot) throw new Error("Loading engine…");
    const config = structuredClone(current.snapshot.config);
    mutate(config);
    return command({ type: reset ? "reset" : "config", config });
  });
  editQueue = result.catch(() => {});
  return result;
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function useEngine<T>(select: (state: EngineState) => T) {
  return useSyncExternalStore(subscribe, () => select(current));
}
export const run = (promise: Promise<unknown>) => {
  void promise.catch(() => {});
};
declare global {
  interface Window {
    LAB_WORKER_URL?: string;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker?.terminate();
    pending.forEach((request) =>
      request.reject(new Error("Interface reloaded")),
    );
    pending.clear();
  });
}
