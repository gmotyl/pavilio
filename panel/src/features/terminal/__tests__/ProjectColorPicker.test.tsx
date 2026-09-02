import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { ProjectColorPicker, PROJECT_COLOR_PRESETS } from "../ProjectColorPicker";
import { useProjectColors } from "../useProjectColors";
import { PROJECT_COLOR_PRESETS as SERVER_PRESETS } from "../../../../server/lib/project-colors";
import { TEST_PROJECT_COLORS, installProjectColors } from "./projectColors.harness";

const GOLD = TEST_PROJECT_COLORS.alpha; // #f0c674, held by "alpha"
const CORAL = TEST_PROJECT_COLORS.beta; // #e06c75, held by "beta"

/** Every write the picker put on the wire. */
function colorWrites() {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([u]) => String(u).endsWith("/color"));
}

/**
 * One more reader of the shared colour store — a stand-in for another session
 * of the same project rendered elsewhere on screen. Proves a preset lands on
 * the *project*, not on the cell the picker was opened from.
 */
function ColorReader({ id, project }: { id: string; project: string }) {
  const { colorFor } = useProjectColors();
  return <span data-testid={`reader-${id}`}>{colorFor(project)}</span>;
}

/**
 * The picker inside a host that behaves like a terminal cell: clicking it
 * focuses, and its header is an HTML5 drag handle. Both are the behaviours the
 * control must not trip.
 */
function renderPicker({
  project = "alpha",
  onFocus = vi.fn(),
  onDragStart = vi.fn(),
  readers = [] as string[],
} = {}) {
  render(
    <div data-testid="cell" onClick={onFocus} draggable onDragStart={onDragStart}>
      <ProjectColorPicker project={project} testId="project-color-trigger" />
      {readers.map((id) => (
        <ColorReader key={id} id={id} project={project} />
      ))}
    </div>,
  );
  return { onFocus, onDragStart };
}

const openPicker = () => {
  fireEvent.click(screen.getByTestId("project-color-trigger"));
  return screen.getByRole("dialog");
};

describe("ProjectColorPicker", () => {
  beforeEach(() => installProjectColors());

  it("keeps the client preset list in step with the server's", () => {
    expect(PROJECT_COLOR_PRESETS).toEqual(SERVER_PRESETS);
  });

  it("opens the picker naming the project", () => {
    renderPicker({ project: "alpha" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const panel = openPicker();

    expect(panel).toHaveTextContent("alpha");
  });

  it("applies a preset to the whole project", async () => {
    renderPicker({ project: "alpha", readers: ["s1", "s2"] });

    await waitFor(() =>
      expect(screen.getByTestId("reader-s1")).toHaveTextContent(GOLD),
    );

    const panel = openPicker();
    fireEvent.click(within(panel).getByRole("button", { name: /^purple/i }));

    // Every session of the project, not just the cell it was opened from.
    await waitFor(() =>
      expect(screen.getByTestId("reader-s1")).toHaveTextContent("#c678dd"),
    );
    expect(screen.getByTestId("reader-s2")).toHaveTextContent("#c678dd");

    // …and persisted.
    const writes = colorWrites();
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toBe("/api/projects/alpha/color");
    expect(writes[0][1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ hex: "#c678dd" });
  });

  it("marks a colour already used by another project", async () => {
    renderPicker({ project: "alpha" });

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/projects/colors",
      ),
    );

    const panel = openPicker();
    const taken = within(panel).getByRole("button", { name: /coral.*beta/i });

    expect(taken).toBeEnabled();
    expect(taken).toHaveTextContent("beta");

    // Advisory only — it still applies.
    fireEvent.click(taken);
    await waitFor(() => expect(colorWrites()).toHaveLength(1));
    expect(JSON.parse(String(colorWrites()[0][1]?.body))).toEqual({ hex: CORAL });
  });

  it("refuses an invalid custom hex", async () => {
    renderPicker({ project: "alpha" });

    const panel = openPicker();
    fireEvent.change(within(panel).getByLabelText(/custom hex/i), {
      target: { value: "nope" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: /apply/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(colorWrites()).toHaveLength(0);
    // Still open, so the typo can be corrected in place.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("accepts a valid custom hex", async () => {
    renderPicker({ project: "alpha" });

    const panel = openPicker();
    fireEvent.change(within(panel).getByLabelText(/custom hex/i), {
      target: { value: "#abc" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: /apply/i }));

    await waitFor(() => expect(colorWrites()).toHaveLength(1));
    expect(JSON.parse(String(colorWrites()[0][1]?.body))).toEqual({ hex: "#abc" });
  });

  it("does not focus or drag the cell when activated", async () => {
    const { onFocus, onDragStart } = renderPicker({ project: "alpha" });

    const panel = openPicker();
    expect(onFocus).not.toHaveBeenCalled();

    // The hex field lives inside a `draggable` header; without a stop, mouse
    // interaction with it starts a cell drag instead of a text selection.
    fireEvent.dragStart(within(panel).getByLabelText(/custom hex/i));
    expect(onDragStart).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("button", { name: /^purple/i }));
    await waitFor(() => expect(colorWrites()).toHaveLength(1));
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("closes when clicking outside", () => {
    renderPicker({ project: "alpha" });
    openPicker();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
