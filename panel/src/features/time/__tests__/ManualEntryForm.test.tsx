import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ManualEntryForm } from "../ManualEntryForm";
import { localISODate } from "../dateLocal";

describe("ManualEntryForm", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const setup = () => {
    const onSaved = vi.fn();
    const utils = render(<ManualEntryForm project="metro" onSaved={onSaved} />);
    const hhmmInput = screen.getByPlaceholderText(
      /e\.g\. 1:30/i,
    ) as HTMLInputElement;
    const noteInput = screen.getByPlaceholderText(/note/i) as HTMLInputElement;
    const dateInput = utils.container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: /save/i });
    return { ...utils, onSaved, hhmmInput, noteInput, dateInput, submit };
  };

  it("rejects invalid HH:MM and does NOT POST", async () => {
    const { hhmmInput, submit, onSaved } = setup();
    fireEvent.change(hhmmInput, { target: { value: "abc" } });
    fireEvent.click(submit);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/use HH:MM or minutes/i),
    ).toBeInTheDocument();
  });

  it("submits valid HH:MM with correct POST body shape", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    } as Response);

    const { hhmmInput, noteInput, dateInput, submit, onSaved } = setup();
    fireEvent.change(hhmmInput, { target: { value: "1:30" } });
    fireEvent.change(noteInput, { target: { value: "design review" } });
    fireEvent.change(dateInput, { target: { value: "2026-05-25" } });
    fireEvent.click(submit);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/time/append");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });

    const body = JSON.parse(init?.body as string);
    expect(body.project).toBe("metro");
    expect(body.entry).toMatchObject({
      type: "manual",
      date: "2026-05-25",
      minutes: 90,
      note: "design review",
    });
    expect(typeof body.entry.createdAt).toBe("string");
    // createdAt should be a valid ISO timestamp
    expect(Number.isNaN(Date.parse(body.entry.createdAt))).toBe(false);
  });

  it("clears HH:MM and note (but keeps date) after successful submit", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    } as Response);

    const { hhmmInput, noteInput, dateInput, submit, onSaved } = setup();
    fireEvent.change(dateInput, { target: { value: "2026-05-20" } });
    fireEvent.change(hhmmInput, { target: { value: "45" } });
    fireEvent.change(noteInput, { target: { value: "standup" } });
    fireEvent.click(submit);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    expect(hhmmInput.value).toBe("");
    expect(noteInput.value).toBe("");
    // Date preserved for multi-entry workflow on the same day
    expect(dateInput.value).toBe("2026-05-20");
  });

  it("shows inline error when server responds non-OK", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { hhmmInput, submit, onSaved } = setup();
    fireEvent.change(hhmmInput, { target: { value: "30" } });
    fireEvent.click(submit);

    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("defaults date input to today (local YYYY-MM-DD)", () => {
    const { dateInput } = setup();
    // Local date so that 23:30 doesn't show tomorrow in negative-offset zones.
    expect(dateInput.value).toBe(localISODate());
  });

  describe("prefill with Auto-tracked", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("prefills HH:MM from prefillMinutes on mount", () => {
      render(<ManualEntryForm project="metro" onSaved={vi.fn()} prefillMinutes={90} />);
      const hhmm = screen.getByPlaceholderText(/e\.g\. 1:30/i) as HTMLInputElement;
      expect(hhmm.value).toBe("1:30");
    });

    it("renders empty when prefillMinutes is 0 (placeholder visible)", () => {
      render(<ManualEntryForm project="metro" onSaved={vi.fn()} prefillMinutes={0} />);
      const hhmm = screen.getByPlaceholderText(/e\.g\. 1:30/i) as HTMLInputElement;
      expect(hhmm.value).toBe("");
    });

    it("syncs to new prefillMinutes when the user hasn't edited", () => {
      const { rerender } = render(
        <ManualEntryForm project="metro" onSaved={vi.fn()} prefillMinutes={15} />,
      );
      const hhmm = screen.getByPlaceholderText(/e\.g\. 1:30/i) as HTMLInputElement;
      expect(hhmm.value).toBe("0:15");
      rerender(<ManualEntryForm project="metro" onSaved={vi.fn()} prefillMinutes={30} />);
      expect(hhmm.value).toBe("0:30");
    });

    it("stops overriding once the user types (even to empty)", () => {
      const { rerender } = render(
        <ManualEntryForm project="metro" onSaved={vi.fn()} prefillMinutes={15} />,
      );
      const hhmm = screen.getByPlaceholderText(/e\.g\. 1:30/i) as HTMLInputElement;
      fireEvent.change(hhmm, { target: { value: "" } });
      expect(hhmm.value).toBe("");
      rerender(<ManualEntryForm project="metro" onSaved={vi.fn()} prefillMinutes={30} />);
      // User cleared the field — don't stuff a new value in. Placeholder is visible.
      expect(hhmm.value).toBe("");
    });
  });

  describe("reset Auto-tracked toggle", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("renders the checkbox, defaults to unchecked", () => {
      render(<ManualEntryForm project="metro" onSaved={vi.fn()} />);
      const cb = screen.getByTestId("time-reset-auto-on-save") as HTMLInputElement;
      expect(cb.checked).toBe(false);
    });

    it("persists checkbox state per project in localStorage", () => {
      render(<ManualEntryForm project="metro" onSaved={vi.fn()} />);
      const cb = screen.getByTestId("time-reset-auto-on-save") as HTMLInputElement;
      fireEvent.click(cb);
      expect(localStorage.getItem("pavilio.time.form.metro.resetAutoOnSave")).toBe("true");
    });

    it("rehydrates checkbox state from localStorage on mount", () => {
      localStorage.setItem("pavilio.time.form.metro.resetAutoOnSave", "true");
      render(<ManualEntryForm project="metro" onSaved={vi.fn()} />);
      const cb = screen.getByTestId("time-reset-auto-on-save") as HTMLInputElement;
      expect(cb.checked).toBe(true);
    });

    it("does NOT call onResetAutoRequested when unchecked", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
      const onResetAutoRequested = vi.fn();
      const onSaved = vi.fn();
      render(
        <ManualEntryForm
          project="metro"
          onSaved={onSaved}
          onResetAutoRequested={onResetAutoRequested}
        />,
      );
      const hhmm = screen.getByPlaceholderText(/e\.g\. 1:30/i);
      fireEvent.change(hhmm, { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(onResetAutoRequested).not.toHaveBeenCalled();
    });

    it("calls onResetAutoRequested when checked, after successful save", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
      const onResetAutoRequested = vi.fn();
      const onSaved = vi.fn();
      render(
        <ManualEntryForm
          project="metro"
          onSaved={onSaved}
          onResetAutoRequested={onResetAutoRequested}
        />,
      );
      fireEvent.click(screen.getByTestId("time-reset-auto-on-save"));
      const hhmm = screen.getByPlaceholderText(/e\.g\. 1:30/i);
      fireEvent.change(hhmm, { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(onResetAutoRequested).toHaveBeenCalledTimes(1);
    });

    it("does NOT call onResetAutoRequested when save fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);
      const onResetAutoRequested = vi.fn();
      render(
        <ManualEntryForm
          project="metro"
          onSaved={vi.fn()}
          onResetAutoRequested={onResetAutoRequested}
        />,
      );
      fireEvent.click(screen.getByTestId("time-reset-auto-on-save"));
      const hhmm = screen.getByPlaceholderText(/e\.g\. 1:30/i);
      fireEvent.change(hhmm, { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
      await screen.findByText(/could not save/i);
      expect(onResetAutoRequested).not.toHaveBeenCalled();
    });
  });
});
