import { useEffect, useState } from "react";
import { onEnvironmentSwitch } from "../env/remoteEnv";

const REPO_URL = "https://github.com/coddy-project/coddy-agent";

/** A release version as the tags spell it; a build between them says more. */
const RELEASE_RE = /^\d+\.\d+\.\d+$/;

// One question per server: the version changes only with the server the page
// talks to, and a switch to another one forgets the answer.
let versionRead: Promise<string> | null = null;
onEnvironmentSwitch(() => {
  versionRead = null;
});

/** readServerVersion asks the active environment which build it runs. */
function readServerVersion(): Promise<string> {
  if (!versionRead) {
    versionRead = fetch("/coddy/info", {
      headers: { Accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { version?: unknown } | null) =>
        typeof body?.version === "string" ? body.version.trim() : "",
      )
      .catch(() => "");
  }
  return versionRead;
}

/** resetServerVersionForTests forgets the answer, so a test can give another. */
export function resetServerVersionForTests(): void {
  versionRead = null;
}

/**
 * HeroFooter is the line under the start screen: the project on GitHub, the
 * API reference, and the version of the server the page is talking to, on the
 * right - the local one, a remote, or a node reached through a relay. A
 * release links to its notes; a build between releases is shown as it is.
 */
export function HeroFooter() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    let alive = true;
    void readServerVersion().then((v) => {
      if (alive) {
        setVersion(v);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  const label = /^\d/.test(version) ? `v${version}` : version;
  return (
    <div className="hero-footer">
      <a href={REPO_URL} target="_blank" rel="noopener">
        GitHub
      </a>
      <span className="hero-footer-sep" aria-hidden>
        |
      </span>
      <a href="/docs/" target="_blank" rel="noopener">
        API docs
      </a>
      {version ? (
        <>
          <span className="hero-footer-sep" aria-hidden>
            |
          </span>
          {RELEASE_RE.test(version) ? (
            <a
              href={`${REPO_URL}/releases/tag/${version}`}
              target="_blank"
              rel="noopener"
              className="hero-footer-version"
            >
              {label}
            </a>
          ) : (
            <span className="hero-footer-version">{label}</span>
          )}
        </>
      ) : null}
    </div>
  );
}
