import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitChanges from "../GitChanges";
import { renderWithRouter, stubFetch, jsonResponse } from "../../../test-utils";

const files = [
  { status: "M", path: "src/app.ts" },
  { status: "M", path: "logo.png" },
  { status: "M", path: "huge.log" },
  { status: "D", path: "gone.ts" },
];

const WHOLE = Array.from({ length: 30 }, (_, i) => (i === 19 ? "new" : `line ${i + 1}`)).join("\n") + "\n";
const APP_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -19,3 +19,3 @@",
  " line 19",
  "-old",
  "+new",
  " line 21",
].join("\n");
const BINARY_DIFF = "diff --git a/logo.png b/logo.png\nindex 1111111..2222222 100644\nBinary files a/logo.png and b/logo.png differ\n";

let fileCalls: string[];

beforeEach(() => {
  fileCalls = [];
  stubFetch({
    "/api/git/status": files,
    "/api/git/branches": { branches: ["main"] },
    "/api/git/branch": { branch: "main" },
    "/api/git/suggest-message": { suggestion: "" },
    "/api/git/diff?file=src%2Fapp.ts": { diff: APP_DIFF },
    "/api/git/diff?file=logo.png": { diff: BINARY_DIFF },
    "/api/git/diff?file=huge.log": { diff: "--- a/huge.log\n+++ b/huge.log\n@@ -5,1 +5,1 @@\n-a\n+b" },
    "/api/git/diff?file=gone.ts": { diff: "--- a/gone.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-bye" },
    "/api/git/file": (url: string) => {
      fileCalls.push(url);
      if (url.includes("path=src%2Fapp.ts")) return new Response(WHOLE, { status: 200 });
      if (url.includes("path=logo.png")) return jsonResponse({ error: "binary file", binary: true }, { status: 415 });
      if (url.includes("path=huge.log")) return jsonResponse({ error: "file too large", tooLarge: true, size: 9e6 }, { status: 413 });
      return jsonResponse({ error: "not found" }, { status: 404 });
    },
  });
});

describe("GitChanges file content", () => {
  it("Code shows the whole working-tree file, not just the hunk", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitChanges repo="/r" />);
    await user.click(await screen.findByText("src/app.ts"));
    await user.click(await screen.findByTestId("file-viewer-mode-code"));
    const body = screen.getByTestId("file-viewer-body");
    await waitFor(() => expect(body.querySelector('tr[data-line="30"]')).not.toBeNull());
    expect(body.querySelector('tr[data-line="1"]')).toHaveTextContent("line 1");
    expect(body.querySelector('tr[data-line="20"]')).toHaveAttribute("data-mark", "changed");
    expect(fileCalls[0]).toContain("repo=%2Fr");
  });

  it("a binary file shows the binary notice", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitChanges repo="/r" />);
    await user.click(await screen.findByText("logo.png"));
    expect(await screen.findByText("Binary file — no text diff")).toBeInTheDocument();
  });

  it("a file too large to read still shows its diff", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitChanges repo="/r" />);
    await user.click(await screen.findByText("huge.log"));
    const body = await screen.findByTestId("file-viewer-body");
    expect(body).toHaveTextContent("b");
    expect(screen.getByTestId("file-viewer-mode-diff")).toHaveAttribute("aria-pressed", "true");
  });

  it("a deleted file is not read from disk", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitChanges repo="/r" />);
    await user.click(await screen.findByText("gone.ts"));
    await screen.findByTestId("file-viewer");
    expect(fileCalls).toEqual([]);
  });
});
