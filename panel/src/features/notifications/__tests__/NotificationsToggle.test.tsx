import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NotificationsToggle } from "../NotificationsToggle";
import {
  getNotificationsEnabled,
  notificationsAvailability,
  requestNotificationsPermission,
  setNotificationsEnabled,
  type NotificationsAvailability,
} from "../notificationsEnabled";

// Mocked at the module boundary: the browser permission and the per-device
// storage are covered by notificationsEnabled's own tests; here only the
// control's reaction to each availability matters.
vi.mock("../notificationsEnabled", () => ({
  getNotificationsEnabled: vi.fn(),
  setNotificationsEnabled: vi.fn((on: boolean) => on),
  notificationsAvailability: vi.fn(),
  requestNotificationsPermission: vi.fn(),
}));

const LABEL = "Notify me when a hidden session needs attention";
const BLOCKED = /blocked by your browser/i;
const UNSUPPORTED = /needs a secure \(https\) origin or the installed app/i;

const toggle = (): HTMLInputElement =>
  screen.getByRole("checkbox", { name: LABEL }) as HTMLInputElement;

/** A permission prompt the test answers by hand, to see the switch wait. */
function deferredPrompt(): (answer: NotificationsAvailability) => void {
  let answer!: (value: NotificationsAvailability) => void;
  vi.mocked(requestNotificationsPermission).mockImplementation(
    () =>
      new Promise<NotificationsAvailability>((resolve) => {
        answer = resolve;
      }),
  );
  return (value) => answer(value);
}

beforeEach(() => {
  vi.mocked(getNotificationsEnabled).mockReset().mockReturnValue(false);
  vi.mocked(setNotificationsEnabled)
    .mockReset()
    .mockImplementation((on: boolean) => on);
  vi.mocked(notificationsAvailability).mockReset().mockReturnValue("default");
  vi.mocked(requestNotificationsPermission).mockReset().mockResolvedValue("granted");
});

describe("NotificationsToggle", () => {
  it("requests permission when switched on", async () => {
    const user = userEvent.setup();
    render(<NotificationsToggle />);
    expect(toggle()).toHaveAttribute("id", "notifications-enabled");
    expect(screen.getByTestId("notifications-enabled")).toBe(toggle());
    expect(toggle()).not.toBeChecked();

    await user.click(toggle());

    expect(requestNotificationsPermission).toHaveBeenCalledTimes(1);
  });

  it("settles on after permission is granted", async () => {
    const user = userEvent.setup();
    const answer = deferredPrompt();
    render(<NotificationsToggle />);

    await user.click(toggle());
    // The prompt is still open: the switch must not claim it is on yet.
    expect(requestNotificationsPermission).toHaveBeenCalledTimes(1);
    expect(toggle()).not.toBeChecked();
    expect(setNotificationsEnabled).not.toHaveBeenCalledWith(true);

    vi.mocked(notificationsAvailability).mockReturnValue("granted");
    answer("granted");

    await vi.waitFor(() => expect(toggle()).toBeChecked());
    expect(setNotificationsEnabled).toHaveBeenCalledWith(true);
    expect(screen.queryByText(BLOCKED)).toBeNull();
  });

  it("returns to off and explains the block when permission is refused", async () => {
    const user = userEvent.setup();
    const answer = deferredPrompt();
    render(<NotificationsToggle />);
    expect(screen.queryByText(BLOCKED)).toBeNull();

    await user.click(toggle());
    expect(requestNotificationsPermission).toHaveBeenCalledTimes(1);
    vi.mocked(notificationsAvailability).mockReturnValue("denied");
    answer("denied");

    expect(await screen.findByText(BLOCKED)).toHaveTextContent(/site settings/i);
    expect(toggle()).not.toBeChecked();
    expect(setNotificationsEnabled).not.toHaveBeenCalledWith(true);
  });

  it("renders the blocked state without prompting when permission was already denied", async () => {
    const user = userEvent.setup();
    vi.mocked(notificationsAvailability).mockReturnValue("denied");
    // Stored on from an earlier visit; the browser has since blocked it.
    vi.mocked(getNotificationsEnabled).mockReturnValue(true);
    render(<NotificationsToggle />);

    expect(screen.getByText(BLOCKED)).toBeInTheDocument();
    // Shows the state in effect, not the stored wish.
    expect(toggle()).not.toBeChecked();

    await user.click(toggle());

    expect(notificationsAvailability).toHaveBeenCalled();
    expect(requestNotificationsPermission).not.toHaveBeenCalled();
    expect(toggle()).not.toBeChecked();
    expect(screen.getByText(BLOCKED)).toBeInTheDocument();
  });

  it("renders disabled where the browser has no Notification API", async () => {
    const user = userEvent.setup();
    vi.mocked(notificationsAvailability).mockReturnValue("unsupported");
    render(<NotificationsToggle />);

    expect(notificationsAvailability).toHaveBeenCalled();
    expect(toggle()).toBeDisabled();
    expect(toggle()).not.toBeChecked();
    expect(screen.getByText(UNSUPPORTED)).toBeInTheDocument();
    expect(screen.queryByText(BLOCKED)).toBeNull();

    await user.click(toggle());
    expect(requestNotificationsPermission).not.toHaveBeenCalled();
    expect(toggle()).not.toBeChecked();
  });

  it("switching off stores false and asks for nothing", async () => {
    const user = userEvent.setup();
    vi.mocked(getNotificationsEnabled).mockReturnValue(true);
    vi.mocked(notificationsAvailability).mockReturnValue("granted");
    render(<NotificationsToggle />);
    expect(getNotificationsEnabled).toHaveBeenCalled();
    expect(toggle()).toBeChecked();

    await user.click(toggle());

    expect(toggle()).not.toBeChecked();
    expect(setNotificationsEnabled).toHaveBeenCalledTimes(1);
    expect(setNotificationsEnabled).toHaveBeenCalledWith(false);
    expect(requestNotificationsPermission).not.toHaveBeenCalled();
  });
});
