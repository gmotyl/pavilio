import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetAlertsForTests,
  alerts,
  getAlertsSnapshot,
  subscribeAlerts,
  userActivateAlert,
  userDismissAlert,
} from "../store";

afterEach(() => {
  __resetAlertsForTests();
});

describe("alert store", () => {
  it("pushes an entry per call and returns its id", () => {
    const id = alerts.info("a");
    const snap = getAlertsSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ id, kind: "info", title: "a", persistent: false });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const second = alerts.error("b");
    expect(second).not.toBe(id);
    expect(getAlertsSnapshot()).toHaveLength(2);
  });

  it("a repeated id refreshes in place instead of stacking", () => {
    alerts.warning("first", { id: "x", detail: "one" });
    const beforeSnapshot = getAlertsSnapshot();
    const before = beforeSnapshot[0];
    const returned = alerts.warning("second", { id: "x", detail: "two" });
    const snap = getAlertsSnapshot();
    expect(snap).not.toBe(beforeSnapshot);
    expect(returned).toBe("x");
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ id: "x", title: "second", detail: "two" });
    expect(snap[0].seq).toBeGreaterThan(before.seq);
  });

  it("dismiss removes without calling onDismiss", () => {
    const onDismiss = vi.fn();
    const id = alerts.info("a", { onDismiss });
    alerts.dismiss(id);
    expect(getAlertsSnapshot()).toHaveLength(0);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("userDismissAlert removes and calls onDismiss once", () => {
    const onDismiss = vi.fn();
    const id = alerts.error("a", { onDismiss });
    userDismissAlert(id);
    userDismissAlert(id);
    expect(getAlertsSnapshot()).toHaveLength(0);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("snapshot reference is stable until a change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAlerts(listener);
    const empty = getAlertsSnapshot();
    expect(getAlertsSnapshot()).toBe(empty);

    alerts.success("a");
    const one = getAlertsSnapshot();
    expect(one).not.toBe(empty);
    expect(getAlertsSnapshot()).toBe(one);
    expect(listener).toHaveBeenCalledTimes(1);

    // Dismissing an unknown id is not a change.
    alerts.dismiss("nope");
    expect(getAlertsSnapshot()).toBe(one);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    alerts.info("b");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persistent flag is kept on the entry", () => {
    alerts.warning("a", { persistent: true });
    alerts.info("b");
    const [persistent, transient] = getAlertsSnapshot();
    expect(persistent.persistent).toBe(true);
    expect(transient.persistent).toBe(false);
  });

  it("userActivateAlert removes the entry and calls onClick, not onDismiss", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const id = alerts.info("a", { onClick, onDismiss });
    userActivateAlert(id);
    userActivateAlert(id);
    expect(getAlertsSnapshot()).toHaveLength(0);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
