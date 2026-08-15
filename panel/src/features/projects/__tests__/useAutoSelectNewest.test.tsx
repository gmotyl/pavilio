import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useAutoSelectNewest, type AutoSelectCandidate } from "../useAutoSelectNewest";

function Harness(props: {
  candidates: AutoSelectCandidate[];
  selectedPath: string | null;
  onSelect: (k: string) => void;
  preferredKey?: string | null;
}) {
  useAutoSelectNewest(props);
  return null;
}

describe("useAutoSelectNewest", () => {
  it("selects the max-mtime candidate when nothing is selected", () => {
    const onSelect = vi.fn();
    render(
      <Harness
        candidates={[
          { key: "a", mtime: 10 },
          { key: "b", mtime: 30 },
          { key: "c", mtime: 20 },
        ]}
        selectedPath={null}
        onSelect={onSelect}
      />,
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("prefers preferredKey over newest", () => {
    const onSelect = vi.fn();
    render(
      <Harness
        candidates={[{ key: "a", mtime: 99 }]}
        selectedPath={null}
        onSelect={onSelect}
        preferredKey="starred"
      />,
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("starred");
  });

  it("does nothing when a file is already selected", () => {
    const onSelect = vi.fn();
    render(
      <Harness
        candidates={[{ key: "a", mtime: 10 }]}
        selectedPath="already"
        onSelect={onSelect}
      />,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does nothing when there are no candidates", () => {
    const onSelect = vi.fn();
    render(<Harness candidates={[]} selectedPath={null} onSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
