import { describe, it, expect, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { ProjectActivityLed } from "../ProjectActivityLed";
import {
  _applyEventForTests,
  _resetForTests,
} from "../useTerminalActivityChannel";

afterEach(() => _resetForTests());

const set = (sessionId: string, state: "idle" | "busy" | "attention") =>
  _applyEventForTests({
    sessionId,
    state,
    at: 1,
    attentionSinceAt: state === "attention" ? 1 : undefined,
  });

function leds(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".terminal-led")).map((el) =>
    el.getAttribute("data-state"),
  );
}

describe("ProjectActivityLed", () => {
  it("renders nothing when the project has no open terminals", () => {
    const { container } = render(<ProjectActivityLed sessionIds={[]} />);
    expect(leds(container)).toEqual([]);
  });

  it("shows an idle dot when a terminal is open but not working", () => {
    set("a", "idle");
    const { container } = render(<ProjectActivityLed sessionIds={["a"]} />);
    expect(leds(container)).toEqual(["idle"]);
  });

  it("shows busy AND attention together when both states are present", () => {
    set("a", "busy");
    set("b", "attention");
    const { container } = render(
      <ProjectActivityLed sessionIds={["a", "b"]} />,
    );
    expect(leds(container)).toEqual(["busy", "attention"]);
  });

  it("does not show an idle dot alongside busy/attention", () => {
    set("a", "busy");
    set("b", "idle");
    const { container } = render(
      <ProjectActivityLed sessionIds={["a", "b"]} />,
    );
    expect(leds(container)).toEqual(["busy"]);
  });
});
