/**
 * The speaking alert: one persistent card naming whose voice is playing, fed
 * the host's run events. The end-to-end half — a real run, the queue, the
 * route — is in `autoplay.integration.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAlertsForTests,
  getAlertsSnapshot,
  userActivateAlert,
  userDismissAlert,
} from "../../alerts/store";

const arrival = vi.hoisted(() => ({ arrive: vi.fn(() => () => {}) }));

vi.mock("../../notifications/notificationClickTarget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../notifications/notificationClickTarget")>();
  return { ...actual, arriveFromNotification: arrival.arrive };
});

const { createSpeakingAlert, SPEAKING_ALERT_ID } = await import("../speakingAlert");

const sessions = new Map([
  ["cell-a", { project: "alpha", name: "shell", title: "Build agent" }],
  ["cell-b", { project: "beta", name: "agent two" }],
]);

function setup() {
  const navigate = vi.fn();
  const alert = createSpeakingAlert({
    sessionOf: (sessionId) => sessions.get(sessionId),
    navigate,
  });
  return { alert, navigate };
}

const speaking = () => getAlertsSnapshot().filter((entry) => entry.id === SPEAKING_ALERT_ID);

beforeEach(() => {
  __resetAlertsForTests();
  arrival.arrive.mockClear();
});

describe("speaking alert", () => {
  it("a starting run raises the speaking alert", () => {
    const { alert } = setup();

    alert.onRunChange({ type: "start", sessionId: "cell-a" });

    expect(speaking()).toEqual([
      expect.objectContaining({
        id: "speech-speaking",
        kind: "info",
        title: "Speaking — alpha · Build agent",
        persistent: true,
      }),
    ]);

    // A barge-in into another cell refreshes the one card, never a second one.
    alert.onRunChange({ type: "start", sessionId: "cell-b" });
    expect(speaking()).toEqual([
      expect.objectContaining({ title: "Speaking — beta · agent two" }),
    ]);
    expect(getAlertsSnapshot()).toHaveLength(1);
  });

  it("the speaking alert leaves when the voice stops or pauses", () => {
    const { alert } = setup();
    alert.onRunChange({ type: "start", sessionId: "cell-a" });

    alert.onRunChange({ type: "pause" });
    expect(speaking()).toEqual([]);

    // A programmatic dismissal is not the user's ×: the resume brings it back.
    alert.onRunChange({ type: "resume" });
    expect(speaking()).toHaveLength(1);

    alert.onRunChange({ type: "end" });
    expect(speaking()).toEqual([]);
    // And nothing is speaking, so a stray resume raises nothing.
    alert.onRunChange({ type: "resume" });
    expect(speaking()).toEqual([]);
  });

  it("closing the speaking alert hides it for that run only", () => {
    const { alert } = setup();
    alert.onRunChange({ type: "start", sessionId: "cell-a" });

    userDismissAlert(SPEAKING_ALERT_ID);
    expect(speaking()).toEqual([]);

    // Still hidden across a pause and resume of the same run.
    alert.onRunChange({ type: "pause" });
    alert.onRunChange({ type: "resume" });
    expect(speaking()).toEqual([]);

    // The next run — even in the same cell — raises it again.
    alert.onRunChange({ type: "end" });
    alert.onRunChange({ type: "start", sessionId: "cell-a" });
    expect(speaking()).toHaveLength(1);
  });

  it("a click arrives at the speaking cell and hides the alert until the next run", () => {
    const { alert, navigate } = setup();
    alert.onRunChange({ type: "start", sessionId: "cell-b" });

    userActivateAlert(SPEAKING_ALERT_ID);

    expect(arrival.arrive).toHaveBeenCalledTimes(1);
    const [message, deps] = arrival.arrive.mock.calls[0] as unknown as [
      { sessionId: string; project: string },
      { projectOf: (id: string) => string | undefined; navigate: (path: string) => void },
    ];
    expect(message).toEqual(expect.objectContaining({ sessionId: "cell-b", project: "beta" }));
    expect(deps.projectOf("cell-b")).toBe("beta");
    deps.navigate("/somewhere");
    expect(navigate).toHaveBeenCalledWith("/somewhere");

    // The user is looking at the speaking cell now: no card over it.
    alert.onRunChange({ type: "pause" });
    alert.onRunChange({ type: "resume" });
    expect(speaking()).toEqual([]);

    alert.onRunChange({ type: "start", sessionId: "cell-a" });
    expect(speaking()).toHaveLength(1);
  });

  it("a cell the panel does not list raises nothing", () => {
    const { alert } = setup();
    alert.onRunChange({ type: "start", sessionId: "cell-a" });
    alert.onRunChange({ type: "start", sessionId: "cell-gone" });
    expect(speaking()).toEqual([]);
  });

  it("speech never navigates by itself", () => {
    const { alert, navigate } = setup();
    for (const event of [
      { type: "start", sessionId: "cell-b" },
      { type: "pause" },
      { type: "resume" },
      { type: "start", sessionId: "cell-a" },
      { type: "end" },
    ] as const) {
      alert.onRunChange(event);
    }
    expect(navigate).not.toHaveBeenCalled();
    expect(arrival.arrive).not.toHaveBeenCalled();
  });
});
