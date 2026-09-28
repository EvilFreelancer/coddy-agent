export type SwarmLayoutMode = "tree" | "star";

export const SWARM_LAYOUT_STORAGE_KEY = "coddy_swarm_layout";

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export function readSwarmLayoutMode(storage?: LayoutStorage): SwarmLayoutMode {
  try {
    const resolvedStorage = storage ?? globalThis.localStorage;
    return resolvedStorage?.getItem(SWARM_LAYOUT_STORAGE_KEY) === "star"
      ? "star"
      : "tree";
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
    resolvedStorage?.setItem(SWARM_LAYOUT_STORAGE_KEY, mode);
  } catch {
    // Layout preferences are optional when storage is blocked or full.
  }
}
