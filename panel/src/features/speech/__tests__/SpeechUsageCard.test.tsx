/**
 * Settings → Speech → *Speech usage*: characters sent to speech engines per
 * month, summed across hosts by `GET /api/speech/usage` (design.md § Settings
 * card).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { listEngines } from "anytts";

import { SpeechUsageCard } from "../SpeechUsageCard";
import { jsonResponse, stubFetch } from "../../../test-utils";

const fmt = (n: number) => new Intl.NumberFormat().format(n);
const LABELS = new Map(listEngines().map((engine) => [engine.id, engine.label]));
const label = (id: string) => LABELS.get(id) ?? id;

function usageCalls(mock: ReturnType<typeof stubFetch>) {
  return mock.mock.calls.filter(([url]) => String(url) === "/api/speech/usage");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SpeechUsageCard", () => {
  it("renders months newest first with engine columns and total", async () => {
    const mock = stubFetch({
      "/api/speech/usage": {
        months: [
          { month: "2026-10", engines: { edge: 12345, elevenlabs: 2000 }, total: 14345 },
          { month: "2026-09", engines: { edge: 1000, elevenlabs: 0 }, total: 1000 },
        ],
      },
    });
    render(<SpeechUsageCard />);

    const table = await screen.findByRole("table");
    expect(screen.getByRole("heading", { name: "Speech usage" })).toBeInTheDocument();
    expect(usageCalls(mock)).toHaveLength(1);

    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Month", label("edge"), label("elevenlabs"), "Total"]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((td) => td.textContent))).toEqual([
      ["2026-10", fmt(12345), fmt(2000), fmt(14345)],
      ["2026-09", fmt(1000), fmt(0), fmt(1000)],
    ]);
  });

  it("omits engines with no usage", async () => {
    stubFetch({
      "/api/speech/usage": {
        months: [
          { month: "2026-10", engines: { edge: 500, cartesia: 0 }, total: 500 },
          { month: "2026-09", engines: { edge: 20 }, total: 20 },
        ],
      },
    });
    render(<SpeechUsageCard />);

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Month", label("edge"), "Total"]);
    expect(within(table).queryByText(label("cartesia"))).not.toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    const mock = stubFetch({ "/api/speech/usage": { months: [] } });
    render(<SpeechUsageCard />);

    expect(await screen.findByText("No speech usage yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Speech usage" })).toBeInTheDocument();
    expect(usageCalls(mock)).toHaveLength(1);
  });

  it("shows an error line when the fetch fails", async () => {
    stubFetch({
      "/api/speech/usage": () => {
        throw new Error("connection refused");
      },
    });
    const { unmount } = render(<SpeechUsageCard />);

    expect(await screen.findByTestId("speech-usage-error")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    unmount();

    // A server that answers with an error status fails the same way.
    stubFetch({ "/api/speech/usage": () => jsonResponse({ error: "boom" }, { status: 500 }) });
    render(<SpeechUsageCard />);

    expect(await screen.findByTestId("speech-usage-error")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
