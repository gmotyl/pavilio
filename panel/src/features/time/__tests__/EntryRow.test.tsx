import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EntryRow } from "../EntryRow";

const sample = {
  id: "a1",
  type: "manual" as const,
  date: "2026-05-25",
  minutes: 90,
  note: "PR review",
};

describe("EntryRow", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders idle row with formatted minutes, note, edit and delete buttons", () => {
    render(<EntryRow project="metro" entry={sample} onChange={() => {}} />);
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
    expect(screen.getByText("PR review")).toBeInTheDocument();
    expect(screen.getByTestId("time-entry-edit")).toBeInTheDocument();
    expect(screen.getByTestId("time-entry-delete")).toBeInTheDocument();
  });

  it("clicking edit shows inline form pre-filled with current values", () => {
    render(<EntryRow project="metro" entry={sample} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("time-entry-edit"));
    const hhmm = screen.getByLabelText(/duration/i) as HTMLInputElement;
    const date = screen.getByLabelText(/^date$/i) as HTMLInputElement;
    const note = screen.getByLabelText(/^note$/i) as HTMLInputElement;
    expect(hhmm.value).toBe("1:30");
    expect(date.value).toBe("2026-05-25");
    expect(note.value).toBe("PR review");
  });

  it("save in edit mode PATCHes with the new value and calls onChange", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    const onChange = vi.fn();
    render(<EntryRow project="metro" entry={sample} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("time-entry-edit"));
    const hhmm = screen.getByLabelText(/duration/i) as HTMLInputElement;
    fireEvent.change(hhmm, { target: { value: "1:00" } });
    fireEvent.click(screen.getByTestId("time-entry-edit-save"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/time/entry/a1");
    expect(init?.method).toBe("PATCH");
    const body = JSON.parse(init?.body as string);
    expect(body.project).toBe("metro");
    expect(body.patch).toMatchObject({ minutes: 60, date: "2026-05-25", note: "PR review" });
  });

  it("cancel in edit hides the form", () => {
    render(<EntryRow project="metro" entry={sample} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("time-entry-edit"));
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("time-entry-edit-cancel"));
    expect(screen.queryByLabelText(/duration/i)).toBeNull();
    expect(screen.getByTestId("time-entry-edit")).toBeInTheDocument();
  });

  it("invalid HH:MM in edit does not PATCH", async () => {
    render(<EntryRow project="metro" entry={sample} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("time-entry-edit"));
    const hhmm = screen.getByLabelText(/duration/i) as HTMLInputElement;
    fireEvent.change(hhmm, { target: { value: "garbage" } });
    fireEvent.click(screen.getByTestId("time-entry-edit-save"));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await screen.findByText(/use HH:MM or minutes/i)).toBeInTheDocument();
  });

  it("clicking delete shows a confirmation prompt", () => {
    render(<EntryRow project="metro" entry={sample} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("time-entry-delete"));
    expect(screen.getByText(/delete this entry/i)).toBeInTheDocument();
  });

  it("confirming delete sends DELETE and calls onChange", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true } as Response);
    const onChange = vi.fn();
    render(<EntryRow project="metro" entry={sample} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("time-entry-delete"));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/time/entry/a1?project=metro");
    expect(init?.method).toBe("DELETE");
  });

  it("canceling delete hides the prompt and does not fetch", () => {
    render(<EntryRow project="metro" entry={sample} onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("time-entry-delete"));
    fireEvent.click(screen.getByTestId("time-entry-delete-cancel"));
    expect(screen.queryByText(/delete this entry/i)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
