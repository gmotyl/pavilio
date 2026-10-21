import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSyncedDraft } from "../useSyncedDraft";

type Props = { source: string; hold?: boolean };

function setup(initial: Props) {
  return renderHook(({ source, hold }: Props) => useSyncedDraft(source, source, { hold }), {
    initialProps: initial,
  });
}

describe("useSyncedDraft", () => {
  it("refills the draft when the source key changes", () => {
    const { result, rerender } = setup({ source: "a" });
    act(() => result.current[1]("edited"));
    rerender({ source: "b" });
    expect(result.current[0]).toBe("b");
    expect(result.current[2]).toBe(false);
  });

  it("keeps an in-progress edit while held", () => {
    const { result, rerender } = setup({ source: "a", hold: true });
    act(() => result.current[1]("edited"));
    rerender({ source: "b", hold: true });
    expect(result.current[0]).toBe("edited");
    expect(result.current[2]).toBe(true);
  });

  it("a clean draft catches up when the hold is released", () => {
    const { result, rerender } = setup({ source: "a", hold: true });
    rerender({ source: "b", hold: true });
    // A clean draft has nothing to protect: it follows at once, even while held.
    expect(result.current[0]).toBe("b");
    rerender({ source: "b", hold: false });
    expect(result.current[0]).toBe("b");
    expect(result.current[2]).toBe(false);

    // The release path: an edit held over a source change, then reverted to
    // what it was filled from, is clean again and catches up.
    act(() => result.current[1]("edited"));
    rerender({ source: "b", hold: true });
    rerender({ source: "c", hold: true });
    expect(result.current[0]).toBe("edited");
    act(() => result.current[1]("b"));
    rerender({ source: "c", hold: false });
    expect(result.current[0]).toBe("c");
    expect(result.current[2]).toBe(false);
  });

  it("a dirty draft does not catch up when the hold is released", () => {
    const { result, rerender } = setup({ source: "a", hold: true });
    act(() => result.current[1]("edited"));
    rerender({ source: "b", hold: true });
    rerender({ source: "b", hold: false });
    expect(result.current[0]).toBe("edited");
    expect(result.current[2]).toBe(true);
    // Settled on the new source: a later change refills as usual.
    rerender({ source: "c", hold: false });
    expect(result.current[0]).toBe("c");
  });

  it("dirty is false when the draft equals the source", () => {
    const { result } = renderHook(() =>
      useSyncedDraft({ name: "x", command: "y" }, "k"),
    );
    expect(result.current[2]).toBe(false);
    act(() => result.current[1]({ name: "x2", command: "y" }));
    expect(result.current[2]).toBe(true);
    // A fresh object with the same fields is equal: compared by value.
    act(() => result.current[1]({ name: "x", command: "y" }));
    expect(result.current[2]).toBe(false);
  });
});
