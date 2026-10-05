/**
 * File-move outcomes are reported as alerts. The old single-slot toast let a
 * second move overwrite the first one's message; the alert stack shows both
 * (`file-move` spec, "Two quick moves both report").
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AlertHost from "../../alerts/AlertHost";
import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";
import { PAVILIO_FILE_MIME_TYPE, useFileDropTarget } from "../useFileDrag";

function Target({ dir }: { dir: string }) {
  const { dropHandlers } = useFileDropTarget(dir);
  return <div data-testid={`target-${dir}`} {...dropHandlers} />;
}

/** A drag payload carrying one panel file, as `useFileDragSource` writes it. */
function dragging(path: string) {
  return {
    dataTransfer: {
      types: [PAVILIO_FILE_MIME_TYPE, "text/plain"],
      getData: (mime: string) => (mime === PAVILIO_FILE_MIME_TYPE || mime === "text/plain" ? path : ""),
      setData: () => {},
      dropEffect: "move",
      effectAllowed: "move",
    },
  };
}

const fetchFn = vi.fn();

beforeEach(() => {
  __resetAlertsForTests();
  fetchFn.mockReset();
  fetchFn.mockImplementation(async (_url: string, init: RequestInit) => {
    const { from, to } = JSON.parse(String(init.body)) as { from: string; to: string };
    const name = from.split("/").pop();
    return { ok: true, json: async () => ({ from, to: `${to}/${name}`, renamed: false }) };
  });
  vi.stubGlobal("fetch", fetchFn);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("file-move outcome alerts", () => {
  it("two quick file moves both show an outcome alert", async () => {
    render(
      <>
        <Target dir="alokai/notes" />
        <AlertHost />
      </>,
    );
    const target = screen.getByTestId("target-alokai/notes");

    fireEvent.drop(target, dragging("alokai/a.md"));
    fireEvent.drop(target, dragging("alokai/b.md"));

    await waitFor(() => expect(screen.getAllByTestId("alert")).toHaveLength(2));
    const cards = screen.getAllByTestId("alert");
    expect(cards.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Moved a.md → alokai/notes/"),
        expect.stringContaining("Moved b.md → alokai/notes/"),
      ]),
    );
    expect(getAlertsSnapshot()).toEqual([
      expect.objectContaining({
        kind: "success",
        title: "Moved a.md → alokai/notes/",
        detail: undefined,
        persistent: false,
      }),
      expect.objectContaining({
        kind: "success",
        title: "Moved b.md → alokai/notes/",
        detail: undefined,
        persistent: false,
      }),
    ]);
  });
});
