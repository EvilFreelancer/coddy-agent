export type SwarmLayoutMode = "tree" | "star";

export const SWARM_LAYOUT_STORAGE_KEY = "coddy_swarm_layout";

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export function readSwarmLayoutMode(
  storage: LayoutStorage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): SwarmLayoutMode {
  return storage?.getItem(SWARM_LAYOUT_STORAGE_KEY) === "star"
    ? "star"
    : "tree";
}

export function writeSwarmLayoutMode(
  mode: SwarmLayoutMode,
  storage: LayoutStorage | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): void {
  storage?.setItem(SWARM_LAYOUT_STORAGE_KEY, mode);
}
