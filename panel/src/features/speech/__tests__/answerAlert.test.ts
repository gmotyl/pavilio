/**
 * The answer alert: an in-page card for every answer that ARRIVES, unless the
 * user is already looking at the cell it arrived in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAlertsForTests, getAlertsSnapshot, userActivateAlert } from "../../alerts/store";

const arrival = vi.hoisted(() => ({ arrive: vi.fn(() => () => {}) }));

vi.mock("../../notifications/notificationClickTarget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../notifications/notificationClickTarget")>();
  return { ...actual, arriveFromNotification: arrival.arrive };
});

const {
  alertOnAnswer,
  focusedVisibleSessionIdFor,
  raiseAnswerAlert,
  shouldRaiseAnswerAlert,
} = await import("../answerAlert");

const sessions = new Map([
  ["cell-a", { project: "alpha", name: "shell", title: "Build agent" }],
  ["cell-b", { project: "beta", name: "agent two" }],
]);

/** The panel as the provider reads it: `focused` on screen, the tab visible. */
function deps(focused: string | null, documentVisible = true) {
  return {
    sessionOf: (sessionId: string) => sessions.get(sessionId),
    focusedVisibleSessionId: () => focused,
    documentVisible: () => documentVisible,
    navigate: vi.fn(),
  };
}

const answer = (sessionId: string, text: string) => ({ sessionId, text });

beforeEach(() => {
  __resetAlertsForTests();
  arrival.arrive.mockClear();
});

describe("answer alert", () => {
  it("an arriving answer in another cell raises an answer alert", () => {
    expect(
      shouldRaiseAnswerAlert({
        sessionId: "cell-b",
        recovered: false,
        focusedVisibleSessionId: "cell-a",
        documentVisible: true,
      }),
    ).toBe(true);

    alertOnAnswer(answer("cell-b", "# Done\n\nThe **build** passed."), false, deps("cell-a"));

    expect(getAlertsSnapshot()).toEqual([
      expect.objectContaining({
        id: "answer-cell-b",
        kind: "info",
        title: "beta · agent two",
        detail: "Done The build passed.",
      }),
    ]);
  });

  it("the focused visible cell raises no answer alert", () => {
    expect(
      shouldRaiseAnswerAlert({
        sessionId: "cell-a",
        recovered: false,
        focusedVisibleSessionId: "cell-a",
        documentVisible: true,
      }),
    ).toBe(false);

    alertOnAnswer(answer("cell-a", "Done."), false, deps("cell-a"));

    expect(getAlertsSnapshot()).toEqual([]);
  });

  it("a hidden document still raises the alert for the focused cell", () => {
    expect(
      shouldRaiseAnswerAlert({
        sessionId: "cell-a",
        recovered: false,
        focusedVisibleSessionId: "cell-a",
        documentVisible: false,
      }),
    ).toBe(true);

    alertOnAnswer(answer("cell-a", "Done."), false, deps("cell-a", false));

    expect(getAlertsSnapshot()).toEqual([
      expect.objectContaining({ id: "answer-cell-a", title: "alpha · Build agent" }),
    ]);
  });

  it("answer alerts are keyed per cell", () => {
    const panel = deps(null);
    alertOnAnswer(answer("cell-b", "First."), false, panel);
    alertOnAnswer(answer("cell-a", "Other cell."), false, panel);
    alertOnAnswer(answer("cell-b", "Second."), false, panel);

    // The second answer in B refreshed B's card in place; A has its own.
    expect(getAlertsSnapshot().map(({ id, detail }) => ({ id, detail }))).toEqual([
      { id: "answer-cell-b", detail: "Second." },
      { id: "answer-cell-a", detail: "Other cell." },
    ]);
  });

  it("catch-up recoveries raise no answer alert", () => {
    expect(
      shouldRaiseAnswerAlert({
        sessionId: "cell-b",
        recovered: true,
        focusedVisibleSessionId: null,
        documentVisible: false,
      }),
    ).toBe(false);

    alertOnAnswer(answer("cell-b", "Recovered."), true, deps(null, false));

    expect(getAlertsSnapshot()).toEqual([]);
  });

  it("clicking the answer alert arrives at the cell", () => {
    const arrive = vi.fn();
    raiseAnswerAlert({
      sessionId: "cell-b",
      project: "beta",
      terminalLabel: "agent two",
      markdown: "Done.",
      arrive,
    });
    userActivateAlert("answer-cell-b");
    expect(arrive).toHaveBeenCalledTimes(1);

    // Through the decision path, the click is the notification's own arrival.
    const panel = deps("cell-a");
    alertOnAnswer(answer("cell-b", "Done."), false, panel);
    userActivateAlert("answer-cell-b");

    expect(arrival.arrive).toHaveBeenCalledTimes(1);
    const [message, arrivalDeps] = arrival.arrive.mock.calls[0] as unknown as [
      { sessionId: string; project: string },
      { projectOf: (id: string) => string | undefined; navigate: (path: string) => void },
    ];
    expect(message).toEqual(expect.objectContaining({ sessionId: "cell-b", project: "beta" }));
    expect(arrivalDeps.projectOf("cell-b")).toBe("beta");
    arrivalDeps.navigate("/project/beta/iterm");
    expect(panel.navigate).toHaveBeenCalledWith("/project/beta/iterm");
  });

  it("an answer for a session the panel does not know raises nothing", () => {
    alertOnAnswer(answer("cell-gone", "Done."), false, deps(null));
    expect(getAlertsSnapshot()).toEqual([]);
  });
});

describe("focusedVisibleSessionIdFor", () => {
  const focus = (project: string) => (project === "alpha" ? "cell-a" : null);

  it("is the project's focused cell while its terminals tab is showing", () => {
    expect(focusedVisibleSessionIdFor("/project/alpha/iterm", false, focus)).toBe("cell-a");
  });

  it("is the project's focused cell while the drawer shows its terminals", () => {
    expect(focusedVisibleSessionIdFor("/project/alpha/notes", true, focus)).toBe("cell-a");
  });

  it("is nothing where no terminals are on screen", () => {
    expect(focusedVisibleSessionIdFor("/project/alpha/notes", false, focus)).toBeNull();
    expect(focusedVisibleSessionIdFor("/settings", true, focus)).toBeNull();
  });
});
