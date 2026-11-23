import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FileViewer from "../FileViewer";

const DIFF = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,2 +1,2 @@", " one", "-two", "+TWO"].join("\n");
const FULL = "one\nTWO\nthree";
const BINARY = "diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => vi.restoreAllMocks());

describe("FileViewer copy buttons", () => {
  it("copies the repo-relative path", async () => {
    render(<FileViewer path="src/auth/auth.controller.ts" content="x" defaultMode="code" />);
    const btn = screen.getByTestId("file-viewer-copy-path");
    expect(btn).toHaveAttribute("aria-label", "Copy path");
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("src/auth/auth.controller.ts"));
  });

  it("copies the whole file in Code mode", async () => {
    render(<FileViewer path="src/a.ts" diff={DIFF} content={FULL} status="M" defaultMode="code" />);
    const btn = screen.getByTestId("file-viewer-copy-content");
    expect(btn).toHaveAttribute("aria-label", "Copy file content");
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL));
  });

  it("copies the new-side whole file in Diff mode", async () => {
    render(<FileViewer path="src/a.ts" diff={DIFF} content={FULL} status="M" defaultMode="diff" />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-content"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL));
  });

  it("disables content copy without the whole file", () => {
    render(<FileViewer path="src/a.ts" diff={DIFF} status="M" defaultMode="diff" />);
    expect(screen.getByTestId("file-viewer-copy-content")).toBeDisabled();
    expect(screen.getByTestId("file-viewer-copy-path")).not.toBeDisabled();
  });

  it("disables content copy for a binary file", () => {
    render(<FileViewer path="img.png" diff={BINARY} content="garbage" defaultMode="code" />);
    expect(screen.getByTestId("file-viewer-copy-content")).toBeDisabled();
  });

  it("titles the button Copy failed when the clipboard rejects", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    Object.assign(document, { execCommand: vi.fn().mockReturnValue(false) });
    render(<FileViewer path="src/a.ts" content={FULL} defaultMode="code" />);
    const btn = screen.getByTestId("file-viewer-copy-path");
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute("title", "Copy failed"));
  });
});
