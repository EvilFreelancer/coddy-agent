/**
 * The graph mode's retired name stays in the union until the canvas
 * integration migrates to `"graph"`: without it the current TopologyGraph
 * comparisons would not compile. `readSwarmLayoutMode` never returns it and
 * `writeSwarmLayoutMode` normalizes it to `"graph"`.
 */
export type SwarmLayoutMode =
  | "tree"
  | "graph"
  | /** @deprecated the retired name of the graph mode */ "star";

export const SWARM_LAYOUT_STORAGE_KEY = "coddy_swarm_layout";

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export function readSwarmLayoutMode(storage?: LayoutStorage): SwarmLayoutMode {
  try {
    const resolvedStorage = storage ?? globalThis.localStorage;
    const value = resolvedStorage?.getItem(SWARM_LAYOUT_STORAGE_KEY);
    // "star" is the value the retired mode wrote; the selection it stood for
    // is the graph, so a preference saved before the rename still applies.
    return value === "graph" || value === "star" ? "graph" : "tree";
  } catch {
    return "tree";
  }
}

export function writeSwarmLayoutMode(
  mode: SwarmLayoutMode,
  storage?: LayoutStorage,
): void {
  try {
    const resolvedStorage = storage ?? globalThis.localStorage;
    resolvedStorage?.setItem(
      SWARM_LAYOUT_STORAGE_KEY,
      mode === "star" ? "graph" : mode,
    );
  } catch {
    // Layout preferences are optional when storage is blocked or full.
  }
}
