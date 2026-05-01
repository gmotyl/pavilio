import { describe, expect, test, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect } from "react";
import {
  useTabScrollMemory,
  __resetForTests,
} from "../useTabScrollMemory";

function Harness({
  project,
  section,
  containerRef,
}: {
  project: string;
  section: string | undefined;
  containerRef: React.RefObject<HTMLDivElement>;
}) {
  useTabScrollMemory(project, section, containerRef);
  useEffect(() => {
    if (containerRef.current) containerRef.current.dataset.testReady = "1";
  });
  return null;
}

describe("useTabScrollMemory", () => {
  beforeEach(() => __resetForTests());

  test("restores scroll position when switching back to a section", async () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "scrollTop", {
      get: function () {
        return (this as any)._scrollTop ?? 0;
      },
      set: function (v) {
        (this as any)._scrollTop = v;
      },
    });
    const ref = { current: div };

    const { rerender } = render(
      <Harness project="p" section="plans" containerRef={ref} />,
    );

    // simulate user scroll on plans
    act(() => {
      div.scrollTop = 250;
      div.dispatchEvent(new Event("scroll"));
    });

    // switch to iterm
    rerender(<Harness project="p" section="iterm" containerRef={ref} />);

    // back to plans
    rerender(<Harness project="p" section="plans" containerRef={ref} />);

    // wait one rAF for restore
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(div.scrollTop).toBe(250);
  });
});
