import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FileListSidebar from "../FileListSidebar";

describe("FileListSidebar controls slot", () => {
  it("renders the controls node above the source list", () => {
    render(
      <FileListSidebar
        testId="section-files"
        title="Notes"
        sources={[{ id: "notes", label: "Notes", count: 0, rows: <div>rows</div> }]}
        detail={<div>detail</div>}
        controls={<div data-testid="my-controls">bar</div>}
      />,
    );
    expect(screen.getByTestId("my-controls")).toBeInTheDocument();
  });
});
