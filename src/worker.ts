import type { Command } from "./engine";
import type { Snapshot } from "./model";
type Envelope = Command & { requestId?: number };
declare function importScripts(url: string): void;
declare class Go {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}
const runtime = globalThis as unknown as {
  labCommand: (command: string) => string;
};
importScripts("./wasm_exec.js");
let ready = false,
  paused = false,
  speed = 1;
const command = (c: Envelope): Snapshot & { error?: string } =>
  JSON.parse(runtime.labCommand(JSON.stringify(c)));
let autoPause = false;
function send(c: Envelope = { type: "snapshot" }) {
  const data = command(c);
  if (data.error) {
    postMessage({ type: "error", message: data.error, requestId: c.requestId });
    return;
  }
  if (c.type === "mode") {
    paused = true;
    autoPause = false;
  }
  if (c.type === "request") {
    paused = false;
    autoPause = true;
  }
  if ((c.type === "reset" || c.type === "preset") && data.manualMode) {
    paused = true;
    autoPause = false;
  }
  if (autoPause && !data.focusRunning) {
    paused = true;
    autoPause = false;
  }
  postMessage({
    type: "snapshot",
    data,
    paused,
    speed,
    requestId: c.requestId,
  });
}
onmessage = ({ data }: MessageEvent<Envelope>) => {
  if (!ready) return;
  if (data.type === "pause") paused = !paused;
  else if (data.type === "speed") speed = data.value;
  else if (data.type === "step") {
    paused = true;
    send({ type: "advance", ms: data.ms ?? 1000, requestId: data.requestId });
    return;
  } else {
    send(data);
    return;
  }
  send({ type: "snapshot", requestId: data.requestId });
};
(async () => {
  try {
    const go = new Go();
    const response = await fetch("./core.wasm");
    if (!response.ok) throw new Error("Failed to load core.wasm");
    const { instance } = await WebAssembly.instantiate(
      await response.arrayBuffer(),
      go.importObject,
    );
    go.run(instance);
    ready = true;
    send();
    setInterval(() => {
      send(
        paused ? { type: "snapshot" } : { type: "advance", ms: 100 * speed },
      );
    }, 100);
  } catch (e) {
    postMessage({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
})();
