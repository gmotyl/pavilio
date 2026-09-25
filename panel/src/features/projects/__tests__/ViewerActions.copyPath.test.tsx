import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ViewerActions from "../ViewerActions";
import { openInVSCode } from "../../shell/vscode";

vi.mock("../../shell/vscode", () => ({
  openInVSCode: vi.fn(),
}));

const ABSOLUTE = "/home/greg/git/prv/projects/mockups/boot-legend.html";
const OVERRIDE = "projects/mockups/boot-legend.html";

/** The clipboard spy for the current test. Asserted on in every test so a
 * never-reached spy cannot let a test pass silently. */
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(openInVSCode).mockClear();
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("ViewerActions copy-path override", () => {
  it("copies the absolute path when no override is given", async () => {
    render(<ViewerActions absolutePath={ABSOLUTE} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(ABSOLUTE);
  });

  it("copies the override when one is given", async () => {
    render(<ViewerActions absolutePath={ABSOLUTE} copyPathText={OVERRIDE} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(OVERRIDE);
  });

  it("opens VS Code with the absolute path even when the copied path is overridden", async () => {
    render(<ViewerActions absolutePath={ABSOLUTE} copyPathText={OVERRIDE} />);
    fireEvent.click(screen.getByTestId("file-viewer-vscode"));

    expect(openInVSCode).toHaveBeenCalledTimes(1);
    expect(openInVSCode).toHaveBeenCalledWith(ABSOLUTE);

    // The copy button still takes the override, so the two are independent.
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(OVERRIDE);
  });

  it("shows the copied confirmation for an overridden path", async () => {
    render(<ViewerActions absolutePath={ABSOLUTE} copyPathText={OVERRIDE} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(OVERRIDE);
    await waitFor(() =>
      expect(screen.getByTestId("file-viewer-copy-path")).toHaveTextContent(
        "Copied",
      ),
    );
  });
});
