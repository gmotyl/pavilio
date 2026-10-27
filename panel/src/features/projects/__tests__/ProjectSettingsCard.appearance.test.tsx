import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preferences } from "../../../preferences/declarations";
import { readPreference, writePreference } from "../../../preferences/store";
import ProjectSettingsCard from "../ProjectSettingsCard";
import { __resetMarkHashesForTests } from "../markImage";
import { installProjectColors, rgb } from "../../terminal/__tests__/projectColors.harness";

vi.mock("../../speech/ProjectVoiceSelect", () => ({ ProjectVoiceSelect: () => null }));

beforeEach(() => {
  installProjectColors();
  // jsdom has no object URLs; the Image tab previews a picked file through one.
  URL.createObjectURL = vi.fn(() => "blob:picked");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetMarkHashesForTests();
});

const unfold = () => fireEvent.click(screen.getByRole("button", { name: "Change appearance" }));
const row = () => screen.getByTestId("appearance-row");

describe("ProjectSettingsCard appearance", () => {
  it("Appearance row is collapsed by default with chip and button", () => {
    render(<ProjectSettingsCard project="alpha" />);
    expect(within(row()).getByTestId("project-mark")).toBeTruthy();
    expect(within(row()).getByText("alpha")).toBeTruthy();
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#f0c674");
    expect(screen.getByRole("button", { name: "Change appearance" })).toBeTruthy();
    expect(screen.queryByTestId("project-color-picker")).toBeNull();
    expect(screen.queryByLabelText("Custom hex")).toBeNull();
  });

  it("Change appearance unfolds palette, hex field and the Mark tabs", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    expect(screen.getByTestId("project-color-picker")).toBeTruthy();
    expect(screen.getByLabelText("Custom hex")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Icon" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Emoji" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Image" })).toBeTruthy();
  });

  it("icon tab offers 23 icons and highlights the chosen one", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    const grid = screen.getByTestId("appearance-icons");
    expect(within(grid).getAllByRole("button")).toHaveLength(23);
    expect(screen.getByTestId("appearance-icon-folder").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    expect(screen.getByTestId("appearance-icon-rocket").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("appearance-icon-folder").getAttribute("aria-pressed")).toBe("false");
  });

  it("picking previews live; Apply saves and folds; Cancel discards", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    fireEvent.click(screen.getByTestId("project-color-preset-alpha-blue"));
    expect(within(row()).getByTestId("project-mark-icon-rocket")).toBeTruthy();
    expect(within(row()).getByTestId("project-mark").style.color).toBe(rgb("#61afef"));
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("appearance-body")).toBeNull();
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#f0c674");

    unfold();
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    fireEvent.click(screen.getByTestId("project-color-preset-alpha-blue"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByTestId("appearance-body")).toBeNull();
    expect(within(row()).getByTestId("project-mark-icon-rocket")).toBeTruthy();
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#61afef");
  });

  it("emoji tab rejects non-single-emoji input", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    const input = screen.getByLabelText("Or paste any emoji");
    for (const bad of ["ab", "🚀🚀"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole("alert").textContent).toMatch(/exactly one emoji/i);
      expect(within(row()).queryByText("ab")).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
  });

  it("Escape while unfolded discards the draft and folds", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByTestId("appearance-icon-rocket"));
    fireEvent.keyDown(screen.getByTestId("appearance-body"), { key: "Escape" });
    expect(screen.queryByTestId("appearance-body")).toBeNull();
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
  });

  it("an emoji mark highlights no icon and prefills the Emoji field", () => {
    writePreference(preferences.projectMark, "emoji:🚀", "alpha");
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    const pressed = within(screen.getByTestId("appearance-icons"))
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    expect((screen.getByLabelText("Or paste any emoji") as HTMLInputElement).value).toBe("🚀");
  });

  it("Apply with an emoji mark persists emoji:🚀", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    fireEvent.change(screen.getByLabelText("Or paste any emoji"), { target: { value: "🚀" } });
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(readPreference(preferences.projectMark, "alpha")).toBe("emoji:🚀");
  });

  it("typing a hex only stages a draft; Apply then saves it", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.change(screen.getByLabelText("Custom hex"), { target: { value: "#123456" } });
    fireEvent.keyDown(screen.getByLabelText("Custom hex"), { key: "Enter" });
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#123456");
    expect(readPreference(preferences.projectColor, "alpha")).toBe("#f0c674");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(readPreference(preferences.projectColor, "alpha")).toBe("#123456");
    expect(screen.getByTestId("appearance-chip").getAttribute("data-color")).toBe("#123456");
  });

  it("a colour held by another project still names that project", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    expect(screen.getByTestId("project-color-preset-alpha-coral").getAttribute("title")).toMatch(/used by beta/);
  });

  it("appearance header shows a 28px tile, coloured name and hex", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    const tile = within(row()).getByTestId("project-mark");
    expect(tile.style.width).toBe("28px");
    expect(tile.style.height).toBe("28px");
    expect(within(row()).getByTestId("appearance-name").style.color).toBe(rgb("#f0c674"));
    expect(within(row()).getByTestId("appearance-chip").textContent).toContain("#f0c674");
    fireEvent.click(screen.getByTestId("project-color-preset-alpha-blue"));
    expect(within(row()).getByTestId("appearance-name").style.color).toBe(rgb("#61afef"));
  });

  it("appearance header name uses the light-theme name colour", () => {
    document.documentElement.dataset.theme = "light";
    try {
      render(<ProjectSettingsCard project="alpha" />);
      unfold();
      const probe = document.createElement("span");
      probe.style.color = "color-mix(in srgb, #f0c674 72%, black)";
      expect(within(row()).getByTestId("appearance-name").style.color).toBe(probe.style.color);
      // The tile keeps the raw colour; only the name text is mixed.
      expect(within(row()).getByTestId("project-mark").getAttribute("data-color")).toBe("#f0c674");
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it("mark tabs are Icon, Emoji, Image", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Icon", "Emoji", "Image"]);
  });

  it("emoji grid shows the six categories", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    const cats = within(screen.getByTestId("appearance-emoji-cats")).getAllByRole("button");
    expect(cats.map((c) => c.textContent)).toEqual(["Tech", "Objects", "Nature", "Food", "Symbols", "Faces"]);
    expect(cats[0].getAttribute("aria-pressed")).toBe("true");
    const grid = screen.getByTestId("appearance-emoji-grid");
    expect(within(grid).getByRole("button", { name: "💻" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Food" }));
    expect(screen.getByRole("button", { name: "Food" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(grid).getByRole("button", { name: "🍕" })).toBeTruthy();
    expect(within(grid).queryByRole("button", { name: "💻" })).toBeNull();
    expect(screen.getByLabelText("Or paste any emoji")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
  });

  it("tapping an emoji selects and previews it", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    const rocket = within(screen.getByTestId("appearance-emoji-grid")).getByRole("button", { name: "🚀" });
    expect(rocket.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(rocket);
    expect(rocket.getAttribute("aria-pressed")).toBe("true");
    // Outlined in the project colour.
    expect(rocket.style.boxShadow).toContain("inset");
    expect(within(row()).getByTestId("project-mark").textContent).toBe("🚀");
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(readPreference(preferences.projectMark, "alpha")).toBe("emoji:🚀");
  });

  it("pasting one emoji previews it; other text shows the hint", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    const input = screen.getByLabelText("Or paste any emoji");
    fireEvent.change(input, { target: { value: "🦀" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(row()).getByTestId("project-mark").textContent).toBe("🦀");
    fireEvent.change(input, { target: { value: "crab" } });
    expect(screen.getByRole("alert").textContent).toBe("Enter exactly one emoji, e.g. 🚀");
    // The rejected text is not used: the last good emoji stays the draft.
    expect(within(row()).getByTestId("project-mark").textContent).toBe("🦀");
  });

  it("image tab shows preview, size, limits, replace and remove", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    expect(screen.getByTestId("appearance-image-drop").textContent).toContain(
      "PNG, SVG or WebP, up to 256 KB",
    );
    pickImage(new File([new Uint8Array(42 * 1024)], "logo.png", { type: "image/png" }));
    const drop = screen.getByTestId("appearance-image-drop");
    const preview = within(drop).getByTestId("appearance-image-preview");
    expect(preview.querySelector("img")?.getAttribute("src")).toBe("blob:picked");
    expect(within(drop).getByText("logo.png · 42 KB")).toBeTruthy();
    expect(within(drop).getByRole("button", { name: "Replace…" })).toBeTruthy();
    expect(within(drop).getByRole("button", { name: "Remove" })).toBeTruthy();
    // The header tile previews the picked file too.
    expect(row().querySelector("img")?.getAttribute("src")).toBe("blob:picked");

    fireEvent.click(within(drop).getByRole("button", { name: "Remove" }));
    expect(within(screen.getByTestId("appearance-image-drop")).queryByTestId("appearance-image-preview")).toBeNull();
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
  });

  it("oversize or wrong-type image shows an inline error", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(10)], "anim.gif", { type: "image/gif" }));
    expect(screen.getByTestId("appearance-image-error").textContent).toMatch(/PNG, SVG or WebP/);
    pickImage(new File([new Uint8Array(256 * 1024 + 1)], "big.png", { type: "image/png" }));
    expect(screen.getByTestId("appearance-image-error").textContent).toMatch(/256 KB/);
    expect(screen.queryByTestId("appearance-image-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(markCalls()).toHaveLength(0);
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
  });

  it("a rejected replacement drops the staged pick; Apply uploads nothing", () => {
    writePreference(preferences.projectMark, "image:mark.svg", "alpha");
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "a.png", { type: "image/png" }));
    expect(screen.getByTestId("appearance-image-preview")).toBeTruthy();
    pickImage(new File([new Uint8Array(256 * 1024 + 1)], "b.png", { type: "image/png" }));
    expect(screen.getByTestId("appearance-image-error").textContent).toMatch(/256 KB/);
    expect(screen.queryByText(/a\.png/)).toBeNull();
    expect(row().querySelector("img")?.getAttribute("src")).not.toBe("blob:picked");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picked");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(markCalls().filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    expect(readPreference(preferences.projectMark, "alpha")).toBe("image:mark.svg");
  });

  it("a picked image of exactly 256 KB is accepted", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(256 * 1024)], "edge.png", { type: "image/png" }));
    expect(screen.queryByTestId("appearance-image-error")).toBeNull();
    expect(screen.getByTestId("appearance-image-preview")).toBeTruthy();
  });

  it("apply uploads the picked image then stores the mark", async () => {
    // The server's answer differs from the draft (`image:mark.png`), so the
    // stored value can only come from the PUT response.
    const put = deferMark();
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    const file = new File([new Uint8Array(1024)], "logo.png", { type: "image/png" });
    pickImage(file);
    expect(markCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    const [call] = markCalls();
    expect(call[1]?.method).toBe("PUT");
    expect((call[1]?.body as FormData).get("image")).toBe(file);
    // Nothing is stored until the PUT resolves.
    await Promise.resolve();
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
    put.resolve({ mark: "image:mark.webp", hash: "abc123" });
    await waitFor(() => expect(readPreference(preferences.projectMark, "alpha")).toBe("image:mark.webp"));
    await waitFor(() => expect(screen.queryByTestId("appearance-body")).toBeNull());
    expect(row().querySelector("img")?.getAttribute("src")).toBe(
      "/api/projects/alpha/mark?v=abc123",
    );
  });

  it("a failed upload keeps the mark, shows the error and stays open", async () => {
    const put = deferMark();
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    put.fail(500, { error: "Could not write the mark image" });
    await waitFor(() =>
      expect(screen.getByTestId("appearance-image-error").textContent).toBe(
        "Could not write the mark image",
      ),
    );
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
    expect(screen.getByTestId("appearance-body")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed upload is shown even when another Mark tab is open", async () => {
    const put = deferMark();
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("tab", { name: "Icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    put.fail(500, { error: "Could not write the mark image" });
    await waitFor(() =>
      expect(screen.getByTestId("appearance-image-error").textContent).toBe(
        "Could not write the mark image",
      ),
    );
    expect(screen.getByRole("tab", { name: "Image" }).getAttribute("aria-selected")).toBe("true");
  });

  it("Cancel is disabled while an upload is in flight", async () => {
    deferMark();
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    expect(screen.getByTestId("appearance-body")).toBeTruthy();
  });

  it("Escape during an upload is ignored; the upload's result is stored", async () => {
    // The PUT has already replaced the bytes: folding as "cancel" would hide a
    // change that happened anyway.
    const put = deferMark();
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    fireEvent.keyDown(screen.getByTestId("appearance-body"), { key: "Escape" });
    expect(screen.getByTestId("appearance-body")).toBeTruthy();
    put.resolve({ mark: "image:mark.webp", hash: "abc123" });
    await put.settled();
    await waitFor(() => expect(readPreference(preferences.projectMark, "alpha")).toBe("image:mark.webp"));
    await waitFor(() => expect(screen.queryByTestId("appearance-body")).toBeNull());
  });

  it("draft controls are locked while an upload is in flight", async () => {
    const put = deferMark();
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    const body = screen.getByTestId("appearance-body");
    const drop = screen.getByTestId("appearance-image-drop");
    // `:disabled`, not `.disabled`: a control in a disabled fieldset is
    // disabled without carrying the attribute itself.
    for (const name of ["Replace…", "Remove"]) {
      expect(within(drop).getByRole("button", { name }).matches(":disabled")).toBe(true);
    }
    expect(screen.getByLabelText("Mark image file").matches(":disabled")).toBe(true);
    expect(screen.getByRole("tab", { name: "Icon" }).matches(":disabled")).toBe(true);
    // Every colour swatch and field in the palette too.
    const palette = [...body.querySelectorAll("button, input")].filter(
      (el) => !drop.contains(el) && el.getAttribute("role") !== "tab",
    );
    expect(palette.length).toBeGreaterThan(0);
    for (const el of palette) {
      expect([el.outerHTML.slice(0, 60), el.matches(":disabled")]).toEqual([el.outerHTML.slice(0, 60), true]);
    }
    // A file dropped meanwhile is not picked.
    fireEvent.drop(drop, {
      dataTransfer: { files: [new File([new Uint8Array(8)], "other.svg", { type: "image/svg+xml" })] },
    });
    expect(within(drop).queryByText(/other\.svg/)).toBeNull();
    put.resolve({ mark: "image:mark.png", hash: "abc123" });
    await put.settled();
    await waitFor(() => expect(readPreference(preferences.projectMark, "alpha")).toBe("image:mark.png"));
  });

  it("unmounting during an upload drops the late result", async () => {
    const put = deferMark();
    const { unmount } = render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    unmount();
    put.resolve({ mark: "image:mark.webp", hash: "abc123" });
    await put.settled();
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
  });

  it("cancel after picking an image makes no request", () => {
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    pickImage(new File([new Uint8Array(1024)], "logo.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    expect(readPreference(preferences.projectMark, "alpha")).toBe("");
    expect(within(row()).getByTestId("project-mark-icon-folder")).toBeTruthy();
  });

  it("applying an emoji over an image mark deletes the image", () => {
    writePreference(preferences.projectMark, "image:mark.png", "alpha");
    vi.mocked(globalThis.fetch).mockClear();
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    fireEvent.click(within(screen.getByTestId("appearance-emoji-grid")).getByRole("button", { name: "🚀" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(markCalls().map(([, init]) => init?.method)).toEqual(["DELETE"]);
    expect(readPreference(preferences.projectMark, "alpha")).toBe("emoji:🚀");
  });

  it("the editor stays locked until the image DELETE has finished", async () => {
    // A new upload must not be able to start while the old file is still
    // being deleted, or the late DELETE could remove it.
    writePreference(preferences.projectMark, "image:mark.png", "alpha");
    let answer!: (res: Response) => void;
    const pending = new Promise<Response>((r) => (answer = r));
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) =>
      String(url) === "/api/projects/alpha/mark" && init?.method === "DELETE"
        ? pending
        : ({ ok: true, status: 200, json: async () => ({}) } as Response),
    );
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    fireEvent.click(within(screen.getByTestId("appearance-emoji-grid")).getByRole("button", { name: "🚀" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(markCalls()).toHaveLength(1));
    expect(screen.getByTestId("appearance-body")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    answer({ ok: true, status: 204, json: async () => ({}) } as Response);
    await waitFor(() => expect(screen.queryByTestId("appearance-body")).toBeNull());
    expect(readPreference(preferences.projectMark, "alpha")).toBe("emoji:🚀");
  });
});

function pickImage(file: File) {
  fireEvent.change(screen.getByLabelText("Mark image file"), { target: { files: [file] } });
}

/** Every fetch to the mark route, as [url, init]. */
function markCalls() {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([url]) => String(url) === "/api/projects/alpha/mark");
}

/**
 * Hold the mark route's PUT until the test settles it; everything else stays
 * an empty 200. `settled()` waits until the component has seen the answer.
 */
function deferMark() {
  let answer!: (res: Response) => void;
  const pending = new Promise<Response>((r) => {
    answer = r;
  });
  vi.mocked(globalThis.fetch).mockImplementation(async (url, init) =>
    String(url) === "/api/projects/alpha/mark" && init?.method === "PUT"
      ? pending
      : ({ ok: true, status: 200, json: async () => ({}) } as Response),
  );
  const reply = (status: number, body: object) =>
    answer({ ok: status < 400, status, json: async () => body } as Response);
  return {
    resolve: (body: { mark: string; hash: string }) => reply(200, body),
    fail: (status: number, body: object) => reply(status, body),
    settled: async () => {
      await pending;
      // Let the component's await chain (fetch, then json) run to the end.
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}
