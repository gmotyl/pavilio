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
  // A host editing the cell name keeps focus in its input while the picker is
  // used; `fireEvent` returns false when a handler called `preventDefault`.
  it("picker buttons do not take focus on mousedown", () => {
    renderPicker({ project: "alpha" });

    expect(fireEvent.mouseDown(screen.getByTestId("project-color-trigger"))).toBe(false);
    const panel = openPicker();
    expect(
      fireEvent.mouseDown(within(panel).getByRole("button", { name: /^purple/i })),
    ).toBe(false);
    expect(
      fireEvent.mouseDown(within(panel).getByRole("button", { name: /apply/i })),
    ).toBe(false);
  });

  it("hex input still takes focus on mousedown", () => {
    renderPicker({ project: "alpha" });
    const panel = openPicker();

    expect(fireEvent.mouseDown(within(panel).getByLabelText(/custom hex/i))).toBe(true);
  });

  it("controlled open follows the prop and reports changes", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ProjectColorPicker
        project="alpha"
        testId="project-color-trigger"
        open={false}
        onOpenChange={onOpenChange}
      />,
    );
    const trigger = screen.getByTestId("project-color-trigger");

    // Trigger reports, but the prop still owns the state.
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <ProjectColorPicker
        project="alpha"
        testId="project-color-trigger"
        open
        onOpenChange={onOpenChange}
      />,
    );
    const panel = screen.getByRole("dialog");

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    onOpenChange.mockClear();
    fireEvent.keyDown(within(panel).getByLabelText(/custom hex/i), { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    onOpenChange.mockClear();
    fireEvent.mouseDown(document.body);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    onOpenChange.mockClear();
    fireEvent.click(within(panel).getByRole("button", { name: /^purple/i }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("applying a preset calls onDismiss before closing", () => {
    const order: string[] = [];
    const onDismiss = vi.fn(() => {
      // Still mounted: the host can refocus before the hex field disappears.
      order.push(screen.queryByRole("dialog") ? "dismiss:open" : "dismiss:closed");
    });
    const onOpenChange = vi.fn((open: boolean) => order.push(`open:${open}`));
    render(
      <ProjectColorPicker
        project="alpha"
        open
        onOpenChange={onOpenChange}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^purple/i }));

    expect(order).toEqual(["dismiss:open", "open:false"]);
  });

  it("applying a custom hex calls onDismiss", async () => {
    const onDismiss = vi.fn(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    render(
      <ProjectColorPicker
        project="alpha"
        testId="project-color-trigger"
        onDismiss={onDismiss}
      />,
    );
    const panel = openPicker();
    fireEvent.change(within(panel).getByLabelText(/custom hex/i), {
      target: { value: "#abc" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: /apply/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(colorWrites()).toHaveLength(1));
  });

  it("Escape anywhere in the popover closes it, dismisses, and stops propagation", () => {
    const onDismiss = vi.fn();
    const onHostKeyDown = vi.fn();
    render(
      <div onKeyDown={onHostKeyDown}>
        <ProjectColorPicker
          project="alpha"
          testId="project-color-trigger"
          onDismiss={onDismiss}
        />
      </div>,
    );
    const panel = openPicker();

    // Not only the hex field: any element inside the popover can be the
    // keydown target.
    fireEvent.keyDown(within(panel).getByRole("button", { name: /^purple/i }), {
      key: "Escape",
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onHostKeyDown).not.toHaveBeenCalled();
  });

  it("outside click closes without onDismiss", () => {
    const onDismiss = vi.fn();
    render(
      <ProjectColorPicker
        project="alpha"
        testId="project-color-trigger"
        onDismiss={onDismiss}
      />,
    );
    openPicker();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  describe("inline variant", () => {
    it("the inline picker shows the palette without a trigger", () => {
      const addListener = vi.spyOn(document, "addEventListener");
      render(<ProjectColorPicker project="alpha" variant="inline" />);

      expect(
        screen.queryByRole("button", { name: /set colour for/i }),
      ).not.toBeInTheDocument();
      for (const preset of PROJECT_COLOR_PRESETS) {
        expect(
          screen.getByTestId(`project-color-preset-alpha-${preset.name.toLowerCase()}`),
        ).toBeInTheDocument();
      }
      expect(screen.getByLabelText(/custom hex/i)).toBeInTheDocument();
      // Nothing to close, so no outside-click listener either.
      expect(
        addListener.mock.calls.filter(([type]) => type === "mousedown"),
      ).toHaveLength(0);
      addListener.mockRestore();
    });

    it("picking inline sets the project colour", async () => {
      render(
        <>
          <ProjectColorPicker project="alpha" variant="inline" />
          <ColorReader id="s1" project="alpha" />
        </>,
      );

      fireEvent.click(screen.getByRole("button", { name: /^purple/i }));

      await waitFor(() =>
        expect(screen.getByTestId("reader-s1")).toHaveTextContent("#c678dd"),
      );
      const writes = colorWrites();
      expect(writes).toHaveLength(1);
      expect(String(writes[0][0])).toBe("/api/projects/alpha/color");
      expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ hex: "#c678dd" });
      // Still there — an inline picker has nothing to close.
      expect(screen.getByLabelText(/custom hex/i)).toBeInTheDocument();
    });

    it("the inline picker marks colours used by other projects", async () => {
      render(<ProjectColorPicker project="alpha" variant="inline" />);

      const taken = await screen.findByRole("button", { name: /coral.*beta/i });

      expect(taken).toBeEnabled();
      expect(taken).toHaveTextContent("beta");
    });
  });
});
