import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileTree from "../FileTree";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";

const skillsFiles = [
  { relativePath: "memo/SKILL.md", modified: 1 },
  { relativePath: "memo/EXTRA.md", modified: 1 },
];

// Stub WebSocket since useFileIndex depends on useWebSocket
class MockWebSocket {
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  close() {}
}

describe("FileTree root=skills", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockFetchResponses({
      "/api/files/listing?root=skills": skillsFiles,
      "/api/git/status": [],
      "/api/git/branch": { branch: "main" },
    });
  });

  it("renders memo as a folder header", async () => {
    renderWithRouter(<FileTree root="skills" />);
    await waitFor(() => {
      expect(screen.getByTestId("file-tree-project-memo")).toBeInTheDocument();
    });
  });

  it("shows SKILL.md and EXTRA.md when the memo folder is expanded", async () => {
    const user = userEvent.setup();
    renderWithRouter(<FileTree root="skills" />);
    await waitFor(() => {
      expect(screen.getByTestId("file-tree-project-memo")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("file-tree-project-memo"));
    expect(screen.getByTestId("file-tree-file-memo/SKILL.md")).toBeInTheDocument();
    expect(screen.getByTestId("file-tree-file-memo/EXTRA.md")).toBeInTheDocument();
  });
});
