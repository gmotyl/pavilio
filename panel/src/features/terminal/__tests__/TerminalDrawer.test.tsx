import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { TerminalDrawerProvider } from "../useTerminalDrawer";
import TerminalDrawer from "../TerminalDrawer";

vi.mock("../ProjectTerminalsSurface", () => ({
  __esModule: true,
  default: ({ projectName }: { projectName: string }) => (
    <div data-testid="surface">{projectName}</div>
  ),
}));

function renderAt(path: string, open: boolean, width = 480) {
  if (open) localStorage.setItem("panel:terminalDrawer:open", "true");
  localStorage.setItem("panel:terminalDrawer:width", String(width));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TerminalDrawerProvider>
        <TerminalDrawer />
      </TerminalDrawerProvider>
    </MemoryRouter>,
  );
}

describe("TerminalDrawer", () => {
  it("renders nothing when closed", () => {
    renderAt("/project/vector/memo", false);
    expect(screen.queryByTestId("terminal-drawer")).not.toBeInTheDocument();
  });

  it("renders the current project's surface at the persisted width when open", () => {
    renderAt("/project/vector/memo", true, 520);
    const drawer = screen.getByTestId("terminal-drawer");
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveStyle({ width: "520px" });
    expect(screen.getByTestId("surface")).toHaveTextContent("vector");
  });

  it("closes when the close button is clicked", () => {
    renderAt("/project/vector/memo", true);
    fireEvent.click(screen.getByTestId("terminal-drawer-close"));
    expect(screen.queryByTestId("terminal-drawer")).not.toBeInTheDocument();
  });
});
