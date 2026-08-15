import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithRouter, mockFetchResponses } from "../../../test-utils";
import ContextTab from "../ContextTab";

const ctx = {
  project: "demo",
  sources: [{ id: "project", label: "project", absoluteRoot: "/p" }],
  contexts: [
    { source: "project", filename: "CONTEXT.md", absolutePath: "/p/CONTEXT.md", modified: 5, relativeToProjectsDir: "demo/CONTEXT.md" },
    { source: "project", filename: "GLOSSARY.md", absolutePath: "/p/GLOSSARY.md", modified: 9, relativeToProjectsDir: "demo/GLOSSARY.md" },
  ],
  adrs: [],
  specs: [],
};

describe("ContextTab filter", () => {
  it("filters context files by substring", async () => {
    mockFetchResponses({ "/context": ctx, "/api/projects/demo/context": ctx });
    renderWithRouter(<ContextTab projectName="demo" />, { initialEntries: ["/"] });
    expect(await screen.findByTestId("context-tab-file-project-GLOSSARY.md")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("file-list-filter-input"), { target: { value: "gloss" } });
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByTestId("context-tab-file-project-CONTEXT.md")).not.toBeInTheDocument();
    expect(screen.getByTestId("context-tab-file-project-GLOSSARY.md")).toBeInTheDocument();
  });
});
