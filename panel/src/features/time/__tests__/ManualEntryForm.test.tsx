import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ManualEntryForm } from "../ManualEntryForm";

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

  it("defaults date input to today (YYYY-MM-DD)", () => {
    const { dateInput } = setup();
    const today = new Date().toISOString().slice(0, 10);
    expect(dateInput.value).toBe(today);
  });
});
