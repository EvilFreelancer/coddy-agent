import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AssistantMessage } from "./AssistantMessage";

afterEach(() => cleanup());

test("assistant hides footer while streaming", () => {
  render(<AssistantMessage content="Hi" streaming />);
  expect(screen.queryByTestId("assistant-message-copy")).toBeNull();
});

test("assistant shows copy after stream and copies raw markdown", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  render(
    <AssistantMessage
      content="# Title"
      streaming={false}
      createdAtUtc="2026-01-01T00:00:00.000Z"
    />,
  );
  const copyBtn = screen.getByTestId("assistant-message-copy");
  expect(copyBtn).toHaveAttribute("title", "Copy message");
  copyBtn.click();
  expect(writeText).toHaveBeenCalledWith("# Title");
});

test("renders only a verified file marker as an inline artifact card with actions", () => {
  const artifact = {
    id: "artifact-1",
    name: "report.pdf",
    sha256: "a".repeat(64),
    size: 1024,
    url: "/coddy/sessions/s1/artifacts/artifact-1",
    relativePath: "out/report.pdf",
  };
  render(
    <AssistantMessage
      content={'Ready.\n\n<coddy_file id="artifact-1"/>\n\n<coddy_file id="invented"/>'}
      artifacts={new Map([[artifact.id, artifact]])}
    />,
  );
  expect(screen.getByTestId("inline-artifact-card-artifact-1")).toBeVisible();
  expect(screen.getByText('<coddy_file id="invented"/>')).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Actions for report.pdf" }));
  expect(screen.getByRole("menu")).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Mention source" })).toBeEnabled();
});
