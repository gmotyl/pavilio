import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ViewerActions from "../ViewerActions";

const PATH = "/home/greg/git/prv/projects/notes/foo.md";

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  setSecureContext(true);
});

describe("ViewerActions copy path", () => {
  it("copies via navigator.clipboard in a secure context", async () => {
    setSecureContext(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ViewerActions absolutePath={PATH} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PATH));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("falls back to execCommand when clipboard API is unavailable (LAN http)", async () => {
    setSecureContext(false);
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    render(<ViewerActions absolutePath={PATH} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});
