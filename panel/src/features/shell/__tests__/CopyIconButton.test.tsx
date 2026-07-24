import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CopyIconButton from "../CopyIconButton";

beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("CopyIconButton", () => {
  it("copies its value to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <CopyIconButton value="feat/x" label="Copy branch" data-testid="c" />,
    );
    fireEvent.click(screen.getByTestId("c"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("feat/x"));
  });

  it("is disabled when there is nothing to copy", () => {
    render(<CopyIconButton value="" label="Copy branch" data-testid="c" />);
    expect(screen.getByTestId("c")).toBeDisabled();
  });
});
