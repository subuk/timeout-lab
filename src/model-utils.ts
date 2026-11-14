import type { Group, ResourceConfig, NodeView, Call } from "./model";
export type Box = Group | ResourceConfig;
export function resources(
  box: Box,
  prefix = "",
  shared = false,
): { path: string; box: ResourceConfig; shared: boolean }[] {
  return (box.resources || []).flatMap((child) => {
    const path = [prefix, child.id].filter(Boolean).join("/");
    const common = shared || child.scope === "shared";
    return [
      { path, box: child, shared: common },
      ...resources(child, path, common),
    ];
  });
}
export function definition(group: Group, path: string): Box {
  return path
    .split("/")
    .filter(Boolean)
    .reduce<Box>((box, id) => box.resources!.find((r) => r.id === id)!, group);
}
export function outgoing(box: Box): Call[] {
  return [
    ...box.stages.flatMap((s) => s.calls),
    ...(box.resources || []).flatMap(outgoing),
  ];
}
export function aggregate(nodes: NodeView[]) {
  const sum = (key: keyof NodeView) =>
    nodes.reduce((n, v) => n + Number(v[key] || 0), 0);
  const exited = sum("exited"),
    rps = sum("rps"),
    capacity = sum("loadCapacity");
  const weighted = (key: keyof NodeView) =>
    rps ? nodes.reduce((n, v) => n + Number(v[key]) * v.rps, 0) / rps : 0;
  return {
    active: sum("active"),
    workers: nodes.filter((n) => !n.retired).reduce((a, n) => a + n.workers, 0),
    queue: sum("queue"),
    rps,
    l: sum("l"),
    lambda: sum("lambda"),
    little: sum("little"),
    unfinished: sum("unfinished"),
    meanW: exited
      ? nodes.reduce((a, n) => a + n.meanW * n.exited, 0) / exited
      : 0,
    w: weighted("w"),
    wQueue: weighted("wQueue"),
    wLocal: weighted("wLocal"),
    wChildren: weighted("wChildren"),
    utilization: capacity ? (sum("loadBusy") / capacity) * 100 : 0,
  };
}
