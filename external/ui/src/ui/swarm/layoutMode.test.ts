import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSwarmLayoutMode,
  SWARM_LAYOUT_STORAGE_KEY,
  writeSwarmLayoutMode,
} from "./layoutMode";

class MapStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("swarm layout preference", () => {
  it("defaults a missing preference to tree", () => {
    expect(readSwarmLayoutMode(new MapStorage())).toBe("tree");
  });

  it.each(["unknown", "STAR", " star ", ""])(
    "defaults the unknown value %j to tree",
    (value) => {
      const storage = new MapStorage();
      storage.setItem(SWARM_LAYOUT_STORAGE_KEY, value);
      expect(readSwarmLayoutMode(storage)).toBe("tree");
    },
  );

  it.each(["star", "tree"] as const)("stores and rereads %s", (mode) => {
    const storage = new MapStorage();
    writeSwarmLayoutMode(mode, storage);
    expect(SWARM_LAYOUT_STORAGE_KEY).toBe("coddy_swarm_layout");
    expect(storage.getItem(SWARM_LAYOUT_STORAGE_KEY)).toBe(mode);
    expect(readSwarmLayoutMode(storage)).toBe(mode);
  });

  it("uses browser localStorage when no storage is supplied", () => {
    const storage = new MapStorage();
    vi.stubGlobal("localStorage", storage);
    writeSwarmLayoutMode("star");
    expect(storage.getItem(SWARM_LAYOUT_STORAGE_KEY)).toBe("star");
    expect(readSwarmLayoutMode()).toBe("star");
  });

  it("reads and writes safely without browser storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readSwarmLayoutMode()).toBe("tree");
    expect(() => writeSwarmLayoutMode("star")).not.toThrow();
  });
});
