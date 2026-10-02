import { useState } from "react";

import {
  downloadToolArtifact,
  type ToolArtifact,
} from "../chat/toolArtifacts";
import { useT } from "../i18n/I18nProvider";
import { fileTypeIcon } from "./fileTypeIcon";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Downloadable files deliberately shared by a completed share_file call. They
 * are file cards, never media previews: even an image artifact stays a file
 * with an explicit download action and is not sent to the image lightbox.
 */
export function ToolArtifactCards(props: {
  artifacts: readonly ToolArtifact[];
}) {
  const { t } = useT();
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [downloading, setDownloading] = useState<Set<string>>(() => new Set());

  if (props.artifacts.length === 0) return null;
  return (
    <section className="tool-artifacts" aria-label={t("messages.toolArtifacts")}>
      {props.artifacts.map((artifact) => {
        const { svg, label } = fileTypeIcon("", artifact.name);
        const unavailable = !artifact.url || failed.has(artifact.id);
        const busy = downloading.has(artifact.id);
        const status = unavailable
          ? t("messages.artifactUnavailable")
          : `${label} · ${formatBytes(artifact.size)}`;
        return (
          <article
            key={artifact.id}
            className="tool-artifact-card"
            data-testid={`tool-artifact-card-${artifact.id}`}
          >
            <span className="tool-artifact-icon" aria-hidden="true">
              {svg}
            </span>
            <span className="tool-artifact-info">
              <span className="tool-artifact-name" title={artifact.name}>
                {artifact.name}
              </span>
              <span
                className={
                  unavailable
                    ? "tool-artifact-meta tool-artifact-meta--error"
                    : "tool-artifact-meta"
                }
              >
                {status}
              </span>
            </span>
            <button
              type="button"
              className="tool-artifact-download"
              aria-label={t("messages.downloadArtifact", { fileName: artifact.name })}
              disabled={unavailable || busy}
              onClick={() => {
                if (unavailable || busy) return;
                setDownloading((current) => new Set(current).add(artifact.id));
                void downloadToolArtifact(artifact)
                  .catch(() => {
                    setFailed((current) => new Set(current).add(artifact.id));
                  })
                  .finally(() => {
                    setDownloading((current) => {
                      const next = new Set(current);
                      next.delete(artifact.id);
                      return next;
                    });
                  });
              }}
            >
              {busy ? t("messages.artifactDownloading") : t("messages.downloadArtifactButton")}
            </button>
          </article>
        );
      })}
    </section>
  );
}
