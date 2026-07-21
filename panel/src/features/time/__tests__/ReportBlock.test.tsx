import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ReportBlock } from "../ReportBlock";

const FIXTURE_ENTRIES = [
  { date: "2026-05-19", minutes: 75, note: "alpha" },
  { date: "2026-05-19", minutes: 60, note: "beta" },
  { date: "2026-05-20", minutes: 30, note: "gamma" },
];

const mockFetchEntries = (entries: { date: string; minutes: number; note?: string }[]) => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ entries }),
  } as Response);
};

const flushFetch = async () => {
  await waitFor(() =>
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0),
  );
  // allow the .then setState to flush
  await act(async () => {
    await Promise.resolve();
  });
};

describe("ReportBlock", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
    mockFetchEntries(FIXTURE_ENTRIES);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders three controls + Copy + Download buttons", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    expect(screen.getByTestId("time-report-period")).toBeInTheDocument();
    expect(screen.getByTestId("time-report-format")).toBeInTheDocument();
    expect(screen.getByTestId("time-report-detail")).toBeInTheDocument();
    expect(screen.getByTestId("time-report-copy")).toBeInTheDocument();
    expect(screen.getByTestId("time-report-csv")).toBeInTheDocument();
  });

  it("format toggle updates preview from text to markdown", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    // Default format=text shows the note inline
    expect(screen.getByText(/alpha/)).toBeInTheDocument();

    const formatSelect = screen.getByTestId("time-report-format") as HTMLSelectElement;
    fireEvent.change(formatSelect, { target: { value: "markdown" } });

    // Markdown has the table header `| Date |`
    expect(screen.getByText(/\| Date \|/)).toBeInTheDocument();
  });

  it("detail toggle updates preview to daily rollup", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    const detailSelect = screen.getByTestId("time-report-detail") as HTMLSelectElement;
    fireEvent.change(detailSelect, { target: { value: "daily" } });

    // 75 + 60 = 135 minutes -> 2:15
    expect(screen.getByText(/2:15/)).toBeInTheDocument();
  });

  it("persists prefs to localStorage", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    const periodSelect = screen.getByTestId("time-report-period") as HTMLSelectElement;
    fireEvent.change(periodSelect, { target: { value: "last-week" } });

    await waitFor(() => {
      const raw = localStorage.getItem("pavilio.time.report.metro");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.period).toBe("last-week");
    });
  });

  it("Copy calls clipboard.writeText with formatted text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    // copyToClipboard only uses the async clipboard API in secure contexts
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    fireEvent.click(screen.getByTestId("time-report-copy"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const arg = writeText.mock.calls[0][0] as string;
    expect(arg).toContain("Metro");
    expect(arg).toContain("alpha");
  });

  it("defaults to this-week when no prefs are stored", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    const periodSelect = screen.getByTestId("time-report-period") as HTMLSelectElement;
    expect(periodSelect.value).toBe("this-week");
  });

  it("shows empty-state hint when range returns no entries", async () => {
    mockFetchEntries([]);
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    expect(screen.getByText(/No entries in/)).toBeInTheDocument();
    expect(screen.getByText(/Try a different period above/)).toBeInTheDocument();
  });

  it("Download .csv triggers a download with CSV content regardless of preview format", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    // Track anchor creation
    const realCreateElement = document.createElement.bind(document);
    const click = vi.fn();
    let anchor: HTMLAnchorElement | undefined;
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        anchor = el as HTMLAnchorElement;
        anchor.click = click;
      }
      return el;
    });

    fireEvent.click(screen.getByTestId("time-report-csv"));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(anchor).toBeDefined();
    expect(anchor!.download).toMatch(/^metro-time-.+\.csv$/);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toMatch(/text\/csv/);

    spy.mockRestore();
  });

  it("renders From/To date inputs and new presets", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();
    expect(screen.getByTestId("time-report-from")).toBeInTheDocument();
    expect(screen.getByTestId("time-report-to")).toBeInTheDocument();
    const select = screen.getByTestId("time-report-period") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(["yesterday", "this-year", "last-year", "custom"]),
    );
  });

  it("editing From flips period to custom and refetches with the new from date", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    const fromInput = screen.getByTestId("time-report-from") as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: "2026-01-10" } });

    await waitFor(() => {
      const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("from=2026-01-10"))).toBe(true);
    });

    const select = screen.getByTestId("time-report-period") as HTMLSelectElement;
    expect(select.value).toBe("custom");

    const parsed = JSON.parse(localStorage.getItem("pavilio.time.report.metro") as string);
    expect(parsed.period).toEqual({ from: "2026-01-10", to: expect.any(String) });
  });

  it("editing From past To pulls To up to keep from <= to", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    const toInput = screen.getByTestId("time-report-to") as HTMLInputElement;
    fireEvent.change(toInput, { target: { value: "2026-02-01" } });
    const fromInput = screen.getByTestId("time-report-from") as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: "2026-05-01" } });

    await waitFor(() => {
      const parsed = JSON.parse(localStorage.getItem("pavilio.time.report.metro") as string);
      expect(parsed.period).toEqual({ from: "2026-05-01", to: "2026-05-01" });
    });
  });

  it("editing To before From pulls From down to keep from <= to", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    const fromInput = screen.getByTestId("time-report-from") as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: "2026-05-01" } });
    const toInput = screen.getByTestId("time-report-to") as HTMLInputElement;
    fireEvent.change(toInput, { target: { value: "2026-02-01" } });

    await waitFor(() => {
      const parsed = JSON.parse(localStorage.getItem("pavilio.time.report.metro") as string);
      expect(parsed.period).toEqual({ from: "2026-02-01", to: "2026-02-01" });
    });
  });

  it("labels year presets by the year, not as a month", async () => {
    render(<ReportBlock project="metro" projectLabel="Metro" />);
    await flushFetch();

    const periodSelect = screen.getByTestId("time-report-period") as HTMLSelectElement;
    fireEvent.change(periodSelect, { target: { value: "this-year" } });
    await flushFetch();

    const year = String(new Date().getFullYear());
    // footer reads "N entries · HH:MM · <label>"
    expect(screen.getByText(new RegExp(`· ${year}$`))).toBeInTheDocument();
    expect(screen.queryByText(/Month \d{4}-\d{2}/)).not.toBeInTheDocument();
  });
});
