import React, { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { EnvScope } from "./EnvScope";
import { connectRemote, setEnv } from "./remoteEnv";

// A switch between two remotes happens in place (remoteEnv.switchTo): the app is
// started over on the new server rather than the page being reloaded, and the
// same server with a rotated token is left as it is.

let mounts = 0;

function Probe() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div data-testid="probe" />;
}

beforeEach(() => {
  mounts = 0;
  localStorage.clear();
  setEnv({ mode: "remote", baseUrl: "http://relay:1/swarm/nodes/a", token: "t" });
});

afterEach(() => cleanup());

test("starts the app over on another server, not on another token", () => {
  render(
    <EnvScope>
      <Probe />
    </EnvScope>,
  );
  expect(mounts).toBe(1);
  act(() =>
    setEnv({ mode: "remote", baseUrl: "http://relay:1/swarm/nodes/a", token: "rotated" }),
  );
  expect(mounts).toBe(1);
  act(() =>
    setEnv({ mode: "remote", baseUrl: "http://relay:1/swarm/nodes/b", token: "t" }),
  );
  expect(mounts).toBe(2);
});

// Choosing the same remote again starts the app over on it (remoteEnv.switchTo
// bumps the generation EnvScope keys it by).
test("starts the app over when the same remote is chosen again", () => {
  const realLocation = window.location;
  Object.defineProperty(window, "location", {
    value: { hash: "", reload: () => {} },
    writable: true,
    configurable: true,
  });
  try {
    render(
      <EnvScope>
        <Probe />
      </EnvScope>,
    );
    expect(mounts).toBe(1);
    act(() => connectRemote("http://relay:1/swarm/nodes/a", "t", "a"));
    expect(mounts).toBe(2);
  } finally {
    Object.defineProperty(window, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
  }
});
