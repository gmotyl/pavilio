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

  it("apply uploads the picked image then stores the mark", async () => {
    answerMark({ mark: "image:mark.png", hash: "abc123" });
    render(<ProjectSettingsCard project="alpha" />);
    unfold();
    fireEvent.click(screen.getByRole("tab", { name: "Image" }));
    const file = new File([new Uint8Array(1024)], "logo.png", { type: "image/png" });
    pickImage(file);
    expect(markCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(readPreference(preferences.projectMark, "alpha")).toBe("image:mark.png"));
    const [call] = markCalls();
    expect(call[1]?.method).toBe("PUT");
    expect((call[1]?.body as FormData).get("image")).toBe(file);
    await waitFor(() => expect(screen.queryByTestId("appearance-body")).toBeNull());
    expect(row().querySelector("img")?.getAttribute("src")).toBe(
      "/api/projects/alpha/mark?v=abc123",
    );
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

/** Answer the mark route's PUT with `body`; everything else stays an empty 200. */
function answerMark(body: { mark: string; hash: string }) {
  vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
    ({
      ok: true,
      status: 200,
      json: async () => (String(url) === "/api/projects/alpha/mark" ? body : {}),
    }) as Response,
  );
}
