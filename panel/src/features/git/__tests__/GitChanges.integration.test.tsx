import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitChanges from "../GitChanges";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";

const mockFiles = [
  { status: "M", path: "src/app.ts" },
  { status: "??", path: "src/new-file.ts" },
  { status: "D", path: "old-file.ts" },
];

describe("GitChanges integration", () => {
  beforeEach(() => {
    mockFetchResponses({
      "/api/git/status": mockFiles,
      "/api/git/branch": { branch: "feature/test" },
      "/api/git/branches": { branches: ["main", "feature/test", "develop"] },
      "/api/git/suggest-message": { suggestion: "fix: update app" },
      "/api/git/diff?file=src%2Fnew-file.ts": {
        diff: "diff --git a/src/new-file.ts b/src/new-file.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new-file.ts\n@@ -0,0 +1,2 @@\n+export const hello = 'world';\n+console.log(hello);",
      },
      "/api/git/diff": {
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,3 @@\n-old\n+new",
      },
    });
  });

  it("renders file list from API", async () => {
    renderWithRouter(<GitChanges />);
    await waitFor(() => {
      expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    });
    expect(screen.getByText("src/new-file.ts")).toBeInTheDocument();
    expect(screen.getByText("old-file.ts")).toBeInTheDocument();
  });

  it("shows branch name", async () => {
    renderWithRouter(<GitChanges />);
    await waitFor(() => {
      expect(screen.getByText("feature/test")).toBeInTheDocument();
    });
  });

  it("shows file count", async () => {
    renderWithRouter(<GitChanges />);
    await waitFor(() => {
      expect(screen.getByText("3 changed")).toBeInTheDocument();
    });
  });

  it("clicking a file shows diff view", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitChanges />);
    await waitFor(() => {
      expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    });
    await user.click(screen.getByText("src/app.ts"));
    await waitFor(() => {
      expect(screen.getByText("Back")).toBeInTheDocument();
    });
  });

  it("renders the opened diff with the file viewer", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitChanges highlight="new" />);
    await user.click(await screen.findByText("src/app.ts"));
    const viewer = await screen.findByTestId("file-viewer");
    expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/app.ts");
    expect(screen.getByTestId("file-viewer-mode-diff")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("file-viewer-layout-unified")).toBeInTheDocument();
    expect(viewer.querySelector("mark.fv-hl")).toHaveTextContent("new");
    expect(screen.queryByTestId("git-changes-mode-inline-workspace")).toBeNull();

    await user.click(screen.getByText("Back"));
    expect(screen.queryByTestId("file-viewer")).toBeNull();
  });

  it("shows added file contents for a new file diff", async () => {
    const user = userEvent.setup();
    renderWithRouter(<GitChanges />);
    await waitFor(() => {
      expect(screen.getByText("src/new-file.ts")).toBeInTheDocument();
    });
    await user.click(screen.getByText("src/new-file.ts"));
    await waitFor(() => {
      expect(
        screen.getByText(
          (_, element) =>
            element?.textContent === "export const hello = 'world';",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("file-viewer-header")).toHaveTextContent("src/new-file.ts");
  });

  it("populates commit message from suggestion", async () => {
    renderWithRouter(<GitChanges />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("fix: update app")).toBeInTheDocument();
    });
  });
});
