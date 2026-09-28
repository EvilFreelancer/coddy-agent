import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import {
  environmentKey,
  snapshotEnv,
  subscribeEnv,
  switchGeneration,
} from "./remoteEnv";

/**
 * EnvScope starts the app over when it switches servers in place (a switch
 * between two remotes, or to the same one again, remoteEnv.switchTo):
 * everything the app read belongs to the server it read it from, so it reads
 * again, while the page - and what is on screen until the new answers come -
 * stays. A token that changes for the same server (a rotated one,
 * configuredRemotes.ts) keeps the app as it is.
 */
export function EnvScope(props: { children: ReactNode }) {
  const env = useSyncExternalStore(subscribeEnv, snapshotEnv, snapshotEnv);
  // A switch to the same server again starts the app over as well: it is how
  // everything is read again after that remote came back.
  const key = `${environmentKey(env)}#${switchGeneration()}`;
  return <Fragment key={key}>{props.children}</Fragment>;
}
