import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ViewerActions from "../ViewerActions";

const PATH = "/home/greg/git/prv/projects/notes/foo.md";
const CONTENT = "# Foo\n\nsome source text\n";

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

describe("ViewerActions copy contents", () => {
  it("copies file contents via navigator.clipboard in a secure context", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setSecureContext(true);
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<ViewerActions absolutePath={PATH} content={CONTENT} />);
      fireEvent.click(screen.getByTestId("file-viewer-copy-content"));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(CONTENT));
      expect(screen.getByTestId("file-viewer-copy-content")).toHaveTextContent(
        "Copied",
      );

      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByTestId("file-viewer-copy-content")).toHaveTextContent(
        "Copy",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to execCommand for contents when the clipboard API is unavailable (LAN http)", async () => {
    setSecureContext(false);
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    render(<ViewerActions absolutePath={PATH} content={CONTENT} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-content"));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(
      await screen.findByTestId("file-viewer-copy-content"),
    ).toHaveTextContent("Copied");
  });

  it("keeps the toolbar unchanged when both clipboard paths fail", async () => {
    setSecureContext(false);
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    render(<ViewerActions absolutePath={PATH} content={CONTENT} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-content"));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(screen.getByTestId("file-viewer-copy-content")).toHaveTextContent(
      "Copy",
    );
    expect(screen.getByTestId("file-viewer-copy-path")).toHaveTextContent(
      "Path",
    );
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("disables copy when content is null", () => {
    render(<ViewerActions absolutePath={PATH} content={null} />);

    const button = screen.getByTestId("file-viewer-copy-content");
    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ opacity: "0.4" });
  });

  it("disables copy when content is an empty string", () => {
    render(<ViewerActions absolutePath={PATH} content="" />);

    const button = screen.getByTestId("file-viewer-copy-content");
    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ opacity: "0.4" });
  });

  it("disables copy when content is not provided", () => {
    render(<ViewerActions absolutePath={PATH} />);

    const button = screen.getByTestId("file-viewer-copy-content");
    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ opacity: "0.4" });
  });

  it("does not touch the clipboard when the disabled copy button is clicked", () => {
    setSecureContext(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    render(<ViewerActions absolutePath={PATH} content="" />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-content"));

    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("shows Copied only on the button that was clicked", async () => {
    setSecureContext(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { unmount } = render(
      <ViewerActions absolutePath={PATH} content={CONTENT} />,
    );
    fireEvent.click(screen.getByTestId("file-viewer-copy-content"));

    await waitFor(() =>
      expect(screen.getByTestId("file-viewer-copy-content")).toHaveTextContent(
        "Copied",
      ),
    );
    expect(screen.getByTestId("file-viewer-copy-path")).toHaveTextContent(
      "Path",
    );
    unmount();

    render(<ViewerActions absolutePath={PATH} content={CONTENT} />);
    fireEvent.click(screen.getByTestId("file-viewer-copy-path"));

    await waitFor(() =>
      expect(screen.getByTestId("file-viewer-copy-path")).toHaveTextContent(
        "Copied",
      ),
    );
    expect(screen.getByTestId("file-viewer-copy-content")).toHaveTextContent(
      "Copy",
    );
  });

  it("renders the buttons in the order VS Code, Path, Copy", () => {
    render(<ViewerActions absolutePath={PATH} content={CONTENT} />);

    const ids = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("data-testid"));
    expect(ids).toEqual([
      "file-viewer-vscode",
      "file-viewer-copy-path",
      "file-viewer-copy-content",
    ]);
  });
});

describe("ViewerActions copy feedback timers", () => {
  it("keeps a button's feedback for the full duration when it is clicked again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setSecureContext(true);
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });

      render(<ViewerActions absolutePath={PATH} content={CONTENT} />);
      const path = () => screen.getByTestId("file-viewer-copy-path");

      fireEvent.click(path());
      await waitFor(() => expect(path()).toHaveTextContent("Copied"));

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
      expect(path()).toHaveTextContent("Copied");

      // Re-clicking restarts the countdown; the first click's timer must not
      // truncate the second click's feedback 300ms later.
      fireEvent.click(path());
      await waitFor(() => expect(path()).toHaveTextContent("Copied"));
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(path()).toHaveTextContent("Copied");

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
      expect(path()).toHaveTextContent("Path");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the pending revert timer on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setSecureContext(true);
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });

      const { unmount } = render(
        <ViewerActions absolutePath={PATH} content={CONTENT} />,
      );
      fireEvent.click(screen.getByTestId("file-viewer-copy-path"));
      await waitFor(() =>
        expect(screen.getByTestId("file-viewer-copy-path")).toHaveTextContent(
          "Copied",
        ),
      );
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("one button's expiring timer does not clear the other button's feedback", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setSecureContext(true);
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });

      render(<ViewerActions absolutePath={PATH} content={CONTENT} />);
      const copy = () => screen.getByTestId("file-viewer-copy-content");

      fireEvent.click(screen.getByTestId("file-viewer-copy-path"));
      await waitFor(() =>
        expect(screen.getByTestId("file-viewer-copy-path")).toHaveTextContent(
          "Copied",
        ),
      );

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      fireEvent.click(copy());
      await waitFor(() => expect(copy()).toHaveTextContent("Copied"));

      // t=1500 for the Path click: its timer must not wipe Copy's feedback.
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(copy()).toHaveTextContent("Copied");
    } finally {
      vi.useRealTimers();
    }
  });
});
