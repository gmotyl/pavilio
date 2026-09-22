import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ManualEntryForm } from "../ManualEntryForm";
import { ReportBlock } from "../ReportBlock";
import { preferences } from "../../../preferences/declarations";
import {
  PREFERENCE_PATCH_DEBOUNCE_MS,
  readPreference,
} from "../../../preferences/store";
import { storageKey } from "../../../preferences/types";

/**
 * The Time tab's two remembered choices after the preferences migration.
 *
 * Both used to be raw `localStorage` under the busy accumulator's own prefix —
 * `pavilio.time.report.<project>` and
 * `pavilio.time.form.<project>.resetAutoOnSave` — which is how the accumulator
 * scan came to treat the second one as a project and stamp accumulator JSON
 * over a boolean flag. That crossed write is in the real storage dump, and the
 * codec's behavior on it is pinned below.
 *
 * The other thing pinned here is that a page load writes NOTHING: the report
 * block used to persist its prefs from a mount effect, which against a
 * workspace file is a PATCH and a committed-file write per visit.
 */

/**
 * The cold-render assertion has to be STRUCTURAL. The store skips a write whose
 * stored value already matches, so a mount-write of the declared default
 * reaches no PATCH and leaves no document key — invisible until the stored
 * value differs, and then visible as a choice reverting on every load. Spying
 * on `writePreference` is the only way to see the call the store swallowed.
 */
const { writeSpy } = vi.hoisted(() => ({ writeSpy: vi.fn() }));

vi.mock("../../../preferences/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../preferences/store")>();
  return {
    ...actual,
    writePreference: (...args: Parameters<typeof actual.writePreference>) => {
      writeSpy(...args);
      return actual.writePreference(...args);
    },
  };
});

function doc(): Record<string, unknown> {
  return (globalThis as { __PAVILIO_PREFS__?: Record<string, unknown> })
    .__PAVILIO_PREFS__!;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeSpy.mockClear();
  fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/time/range")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ entries: [] }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const select = (testId: string): HTMLSelectElement =>
  screen.getByTestId(testId) as HTMLSelectElement;

const checkbox = (): HTMLInputElement =>
  screen.getByTestId("time-reset-auto-on-save") as HTMLInputElement;

/** Long enough for a queued PATCH to have left, had one been queued. */
const pastTheDebounce = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) =>
      setTimeout(resolve, PREFERENCE_PATCH_DEBOUNCE_MS * 2),
    );
  });
};

const preferencePatches = (): string[] =>
  fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/preferences"));

describe("time report preferences", () => {
  it("report options do not bleed between projects", async () => {
    const alpha = render(<ReportBlock project="alpha" projectLabel="Alpha" />);
    await screen.findByTestId("time-report-format");

    fireEvent.change(select("time-report-format"), {
      target: { value: "markdown" },
    });
    fireEvent.change(select("time-report-period"), {
      target: { value: "last-week" },
    });

    expect(readPreference(preferences.timeReport, "alpha")).toMatchObject({
      format: "markdown",
      period: "last-week",
    });
    // Nothing was written for a project the user never opened.
    expect(readPreference(preferences.timeReport, "beta")).toEqual(
      preferences.timeReport.default,
    );

    alpha.unmount();
    render(<ReportBlock project="beta" projectLabel="Beta" />);
    await screen.findByTestId("time-report-format");
    expect(select("time-report-period").value).toBe("this-week");
    expect(select("time-report-format").value).toBe("text");
  });

  it("report options are written to the workspace document, not localStorage", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await screen.findByTestId("time-report-detail");

    fireEvent.change(select("time-report-detail"), {
      target: { value: "daily" },
    });

    expect(doc()[storageKey(preferences.timeReport, "metro")]).toMatchObject({
      detail: "daily",
    });
    expect(localStorage.length).toBe(0);
    // Positive control for the cold-render tests: the spy really is the
    // `writePreference` these components reach.
    expect(writeSpy).toHaveBeenCalled();

    await pastTheDebounce();
    expect(preferencePatches()).toEqual(["/api/preferences"]);
  });

  it("fills a partially stored report blob in from the declared default", async () => {
    // `loadPrefs` did `{ ...DEFAULT_PREFS, ...parsed }`, so a hand-seeded or
    // older blob missing a field still rendered. The workspace file is
    // hand-seeded, so that tolerance has to survive the migration.
    doc()[storageKey(preferences.timeReport, "metro")] = { format: "markdown" };

    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await screen.findByTestId("time-report-format");

    expect(select("time-report-format").value).toBe("markdown");
    expect(select("time-report-period").value).toBe("this-week");
    expect(select("time-report-detail").value).toBe("detailed");
  });

  it("a report blob that is not an object at all falls back to the default", async () => {
    doc()[storageKey(preferences.timeReport, "metro")] = "nonsense";

    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await screen.findByTestId("time-report-format");

    expect(select("time-report-period").value).toBe("this-week");
    expect(select("time-report-format").value).toBe("text");
    expect(select("time-report-detail").value).toBe("detailed");
  });
});

describe("the manual entry form's reset-on-save flag", () => {
  it("reads as false when nothing is stored", () => {
    render(<ManualEntryForm project="metro" onSaved={vi.fn()} />);

    expect(checkbox().checked).toBe(false);
  });

  it("a reset-on-save flag holding an object reads as false", () => {
    // The crossed write the storage dump actually held: a phantom accumulator
    // slot, scanned out of `pavilio.time.form.<project>.resetAutoOnSave`,
    // stamped its own JSON over the boolean flag.
    doc()[storageKey(preferences.timeFormResetAutoOnSave, "metro")] = {
      date: "2026-05-26",
      closedMinutes: 0,
      open: null,
    };

    render(<ManualEntryForm project="metro" onSaved={vi.fn()} />);

    expect(checkbox().checked).toBe(false);
    expect(readPreference(preferences.timeFormResetAutoOnSave, "metro")).toBe(
      false,
    );
  });

  it("does not bleed between projects", () => {
    const metro = render(<ManualEntryForm project="metro" onSaved={vi.fn()} />);
    fireEvent.click(checkbox());

    expect(readPreference(preferences.timeFormResetAutoOnSave, "metro")).toBe(
      true,
    );
    expect(readPreference(preferences.timeFormResetAutoOnSave, "ch")).toBe(
      false,
    );

    metro.unmount();
    render(<ManualEntryForm project="ch" onSaved={vi.fn()} />);
    expect(checkbox().checked).toBe(false);
  });
});

describe("the time surface on a cold render", () => {
  it("writes nothing on a cold render", async () => {
    render(
      <>
        <ManualEntryForm project="metro" onSaved={vi.fn()} />
        <ReportBlock project="metro" projectLabel="Metro" />
      </>,
    );
    await screen.findByTestId("time-report-period");
    await pastTheDebounce();

    // The document is untouched: a mount that only READS leaves it as booted.
    expect(Object.keys(doc())).toEqual(["version"]);
    // Structurally, not by its effect: no write was even attempted.
    expect(writeSpy).not.toHaveBeenCalled();
    expect(preferencePatches()).toEqual([]);
  });

  it("writes nothing on a cold render over a document that already holds values", async () => {
    // The seeded values DIFFER from the declared defaults, so a mount-write
    // would be a real change the store could not swallow — and would revert
    // the user's choices on every page load.
    doc()[storageKey(preferences.timeReport, "metro")] = {
      period: "last-week",
      format: "markdown",
      detail: "daily",
    };
    doc()[storageKey(preferences.timeFormResetAutoOnSave, "metro")] = true;
    const before = { ...doc() };

    render(
      <>
        <ManualEntryForm project="metro" onSaved={vi.fn()} />
        <ReportBlock project="metro" projectLabel="Metro" />
      </>,
    );
    await screen.findByTestId("time-report-period");
    // The stored values were honored, so the render really did read them.
    expect(select("time-report-period").value).toBe("last-week");
    expect(select("time-report-format").value).toBe("markdown");
    expect(checkbox().checked).toBe(true);

    await pastTheDebounce();

    expect(doc()).toEqual(before);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(preferencePatches()).toEqual([]);
  });

  it("renders and toggles with no project resolved, and stores nothing", async () => {
    // `ProjectTimePage` passes `name ?? ""`, and a blank scope argument makes
    // `storageKey` throw by design. The unresolved case must render, not crash.
    render(
      <>
        <ManualEntryForm project="" onSaved={vi.fn()} />
        <ReportBlock project="" projectLabel="" />
      </>,
    );
    await screen.findByTestId("time-report-period");

    fireEvent.click(checkbox());
    fireEvent.change(select("time-report-format"), {
      target: { value: "markdown" },
    });

    expect(checkbox().checked).toBe(true);
    expect(select("time-report-format").value).toBe("markdown");
    await pastTheDebounce();
    expect(Object.keys(doc())).toEqual(["version"]);
    expect(localStorage.length).toBe(0);
  });
});
