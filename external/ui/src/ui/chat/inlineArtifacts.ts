import type { ToolArtifact } from "./toolArtifacts";
import type { TranscriptItem } from "./types";
import { opensTurn } from "./backgroundWake";

export type AssistantArtifactToken =
  | { type: "markdown"; text: string }
  | { type: "artifact"; artifact: ToolArtifact };

const FILE_MARKER = /<coddy_file\s+id="([^"<>]+)"\s*\/>/g;

/** Artifacts published earlier in this turn. IDs are server-issued and unique. */
export function artifactMarkersForAssistant(
  items: readonly TranscriptItem[],
  assistantIndex: number,
): Map<string, ToolArtifact> {
  const result = new Map<string, ToolArtifact>();
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;
    if (opensTurn(item)) break;
    if (item.type !== "tool_call") continue;
    for (const artifact of item.artifacts || []) result.set(artifact.id, artifact);
  }
  return result;
}

/**
 * Replaces only exact markers naming an artifact the session actually published.
 * A hallucinated marker remains ordinary assistant Markdown/text.
 */
export function tokenizeAssistantArtifacts(
  content: string,
  artifacts: ReadonlyMap<string, ToolArtifact>,
): AssistantArtifactToken[] {
  const out: AssistantArtifactToken[] = [];
  let at = 0;
  FILE_MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_MARKER.exec(content)) !== null) {
    const artifact = artifacts.get(match[1] || "");
    if (!artifact) continue;
    const before = content.slice(at, match.index);
    if (before) out.push({ type: "markdown", text: before });
    out.push({ type: "artifact", artifact });
    at = match.index + match[0].length;
  }
  const tail = content.slice(at);
  if (tail || out.length === 0) out.push({ type: "markdown", text: tail });
  return out;
}

export function artifactMarkerIds(content: string, artifacts: ReadonlyMap<string, ToolArtifact>): Set<string> {
  return new Set(
    tokenizeAssistantArtifacts(content, artifacts)
      .filter((token): token is Extract<AssistantArtifactToken, { type: "artifact" }> => token.type === "artifact")
      .map((token) => token.artifact.id),
  );
}
