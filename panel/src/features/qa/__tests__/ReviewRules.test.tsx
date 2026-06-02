import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../markdown/MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));

import ReviewRules from "../ReviewRules";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mockRead(ok: boolean, content = "") {
  fetchMock.mockResolvedValueOnce({
    ok,
    json: async () => ({ content }),
  });
}

describe("ReviewRules", () => {
  it("renders existing rules content", async () => {
    mockRead(true, "# My Rules");
    render(<ReviewRules project="ch" />);
    expect(await screen.findByTestId("md")).toHaveTextContent("# My Rules");
    expect(fetchMock).toHaveBeenCalledWith("/api/files/read/ch/qa/REVIEW_RULES.md");
  });

  it("shows a Create button when the file is missing (404)", async () => {
    mockRead(false);
    render(<ReviewRules project="ch" />);
    expect(await screen.findByRole("button", { name: /create rules/i })).toBeInTheDocument();
  });

  it("creates the rules file from the template on Create", async () => {
    mockRead(false);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // write
    render(<ReviewRules project="ch" />);
    fireEvent.click(await screen.findByRole("button", { name: /create rules/i }));
    await waitFor(() => {
      const writeCall = fetchMock.mock.calls.find((c) => c[0] === "/api/files/write");
      expect(writeCall).toBeTruthy();
      const body = JSON.parse(writeCall![1].body);
      expect(body.path).toBe("ch/qa/REVIEW_RULES.md");
      expect(body.content).toContain("## Conventions");
    });
  });

  it("saves edited content via the write endpoint", async () => {
    mockRead(true, "# Old");
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // write
    render(<ReviewRules project="ch" />);
    fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "# New rules" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      const writeCall = fetchMock.mock.calls.find((c) => c[0] === "/api/files/write");
      expect(JSON.parse(writeCall![1].body).content).toBe("# New rules");
    });
  });

  it("keeps the editor open and shows an error when save fails", async () => {
    mockRead(true, "# Old");
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) }); // write fails
    render(<ReviewRules project="ch" />);
    fireEvent.click(await screen.findByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# New" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
