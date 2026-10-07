import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import MockupImportDialog from "../MockupImportDialog";
import { MOCKUP_MAX_FILES, MOCKUP_MAX_TOTAL_BYTES } from "../mockupFiles";
import { __resetAlertsForTests, getAlertsSnapshot } from "../../alerts/store";

const MB = 1024 * 1024;

/** A File whose reported size can exceed what the test wants to allocate. */
function makeFile(name: string, { size, type = "" }: { size?: number; type?: string } = {}) {
  const file = new File(["x"], name, { type });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

interface Calls {
  inspect: FormData[];
  importBodies: FormData[];
}

/**
 * Routes the two import endpoints; `inspect` answers per sent file from
 * `externalCounts` (by name), `import` answers with `importResult` built from
 * what was actually sent.
 */
function stubFetch({
  externalCounts = {},
  importResult,
  serverDates = ["2026-10-07"],
}: {
  externalCounts?: Record<string, number>;
  /** What `/mockups/today` answers, call by call; the last one repeats. */
  serverDates?: string[];
  importResult?: (names: string[]) => Array<{
    name: string;
    relativePath: string;
    ok: boolean;
    error?: string;
  }>;
} = {}): Calls {
  const calls: Calls = { inspect: [], importBodies: [] };
  let todayCalls = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/mockups/today")) {
      const date = serverDates[Math.min(todayCalls++, serverDates.length - 1)];
      return { ok: true, json: async () => ({ date }) } as Response;
    }
    const body = init?.body as FormData;
    const names = body ? body.getAll("files").map((f) => (f as File).name) : [];
    if (url.endsWith("/mockups/inspect")) {
      calls.inspect.push(body);
      return {
        ok: true,
        json: async () => ({
          files: names.map((name) => ({ name, externalCount: externalCounts[name] ?? 0 })),
        }),
      } as Response;
    }
    if (url.endsWith("/mockups/import")) {
      calls.importBodies.push(body);
      const files = importResult
        ? importResult(names)
        : names.map((name) => ({
            name,
            relativePath: `pavilio/mockups/2026-10-07-${name}`,
            ok: true,
          }));
      return { ok: true, json: async () => ({ files }) } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderDialog(files: File[], onImported = vi.fn(), onClose = vi.fn()) {
  render(
    <MockupImportDialog
      project="pavilio"
      files={files}
      onClose={onClose}
      onImported={onImported}
    />,
  );
  return { onImported, onClose };
}

const rows = () => screen.getAllByTestId("mockup-import-row");

/** Import is held until the server's date is known, so wait for it first. */
async function clickConfirm(times = 1) {
  const confirm = screen.getByTestId("mockup-import-confirm") as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(false));
  await act(async () => {
    for (let i = 0; i < times; i++) fireEvent.click(confirm);
  });
}

describe("MockupImportDialog", () => {
  beforeEach(() => {
    __resetAlertsForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:thumb"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("dialog prefills slug from basename", async () => {
    stubFetch();
    renderDialog([makeFile("Frame 12.png", { type: "image/png" }), makeFile("Hero Page.jpeg")]);

    const [png, jpeg] = rows();
    await waitFor(() =>
      expect(within(png).getByTestId("mockup-import-prefix").textContent).toBe("2026-10-07-"),
    );
    expect((within(png).getByTestId("mockup-import-slug") as HTMLInputElement).value).toBe(
      "frame-12",
    );
    expect(within(png).getByTestId("mockup-import-ext").textContent).toBe(".png");
    // The thumbnail is an object URL of the picked file, not a server round trip.
    expect(within(png).getByTestId("mockup-import-thumb").getAttribute("src")).toBe("blob:thumb");
    // The server saves .jpeg as .jpg, so the dialog shows what will be written.
    expect((within(jpeg).getByTestId("mockup-import-slug") as HTMLInputElement).value).toBe(
      "hero-page",
    );
    expect(within(jpeg).getByTestId("mockup-import-ext").textContent).toBe(".jpg");
    await waitFor(() => expect(screen.getByTestId("mockup-import-confirm")).toBeTruthy());
  });

  it("warns about external resources", async () => {
    const calls = stubFetch({ externalCounts: { "landing.html": 3 } });
    renderDialog([makeFile("landing.html", { type: "text/html" }), makeFile("a.png")]);

    const [html] = rows();
    expect(
      (await within(html).findByTestId("mockup-import-warning")).textContent,
    ).toBe("Loads 3 external resources — they will not load offline");
    // An HTML mockup is never framed in the dialog — a glyph, not its content.
    expect(html.querySelector("iframe")).toBeNull();
    expect(within(html).queryByTestId("mockup-import-thumb")).toBeNull();
    // Raster files carry no external references, so they are not inspected.
    expect(calls.inspect).toHaveLength(1);
    expect(calls.inspect[0].getAll("files").map((f) => (f as File).name)).toEqual([
      "landing.html",
    ]);
    expect((screen.getByTestId("mockup-import-confirm") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("rejects oversize and unsupported before upload", async () => {
    const calls = stubFetch();
    const { onImported } = renderDialog([
      makeFile("huge.png", { size: 21 * MB }),
      makeFile("brief.pdf"),
      makeFile("ok.webp"),
    ]);

    const [huge, pdf, ok] = rows();
    expect(within(huge).getByTestId("mockup-import-rejected").textContent).toMatch(/20 MB/);
    expect(within(pdf).getByTestId("mockup-import-rejected").textContent).toMatch(
      /unsupported/i,
    );
    expect(within(huge).queryByTestId("mockup-import-slug")).toBeNull();
    expect(within(ok).queryByTestId("mockup-import-rejected")).toBeNull();

    await clickConfirm();

    expect(calls.importBodies).toHaveLength(1);
    const sent = calls.importBodies[0];
    expect(sent.getAll("files").map((f) => (f as File).name)).toEqual(["ok.webp"]);
    expect(sent.getAll("slugs")).toEqual(["ok"]);
    expect(onImported).toHaveBeenCalledWith(["pavilio/mockups/2026-10-07-ok.webp"]);
  });

  it("partial failure raises an alert", async () => {
    stubFetch({
      importResult: (names) =>
        names.map((name) =>
          name === "fake.png"
            ? { name, relativePath: "", ok: false, error: "Content does not match .png" }
            : { name, relativePath: `pavilio/mockups/2026-10-07-${name}`, ok: true },
        ),
    });
    const { onImported } = renderDialog([makeFile("fake.png"), makeFile("real.svg")]);

    await clickConfirm();

    // The rest of the batch still lands.
    expect(onImported).toHaveBeenCalledWith(["pavilio/mockups/2026-10-07-real.svg"]);
    const alerts = getAlertsSnapshot();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("error");
    expect(alerts[0].title).toMatch(/1 of 2/);
    expect(alerts[0].detail).toContain("fake.png: Content does not match .png");
  });

  it("sends the edited slug as typed — the server normalises it", async () => {
    const calls = stubFetch();
    renderDialog([makeFile("Frame 12.png")]);

    fireEvent.change(screen.getByTestId("mockup-import-slug"), {
      target: { value: "Account Details / Mobile!!" },
    });
    await clickConfirm();
    expect(calls.importBodies[0].getAll("slugs")).toEqual(["Account Details / Mobile!!"]);
  });

  it("maps inspect results to the html row when an image precedes it", async () => {
    const calls = stubFetch({ externalCounts: { "landing.html": 2 } });
    renderDialog([makeFile("a.png"), makeFile("landing.html", { type: "text/html" })]);

    const [png, html] = rows();
    expect(
      (await within(html).findByTestId("mockup-import-warning")).textContent,
    ).toBe("Loads 2 external resources — they will not load offline");
    expect(within(png).queryByTestId("mockup-import-warning")).toBeNull();
    expect(calls.inspect[0].getAll("files").map((f) => (f as File).name)).toEqual([
      "landing.html",
    ]);
  });

  it("rejects files beyond the per-import limit and does not send them", async () => {
    expect(MOCKUP_MAX_FILES).toBe(50);
    const calls = stubFetch();
    // An unsupported file does not use up one of the 50 slots.
    const files = [
      makeFile("brief.pdf"),
      ...Array.from({ length: MOCKUP_MAX_FILES + 2 }, (_, i) => makeFile(`f${i}.png`)),
    ];
    renderDialog(files);

    const all = rows();
    expect(all).toHaveLength(MOCKUP_MAX_FILES + 3);
    expect(within(all[MOCKUP_MAX_FILES]).queryByTestId("mockup-import-rejected")).toBeNull();
    for (const row of all.slice(MOCKUP_MAX_FILES + 1)) {
      expect(within(row).getByTestId("mockup-import-rejected").textContent).toBe(
        "Rejected — At most 50 files per import",
      );
    }
    expect(screen.getByTestId("mockup-import-confirm").textContent).toBe("Import 50");

    await clickConfirm();
    const sent = calls.importBodies[0].getAll("files").map((f) => (f as File).name);
    expect(sent).toHaveLength(MOCKUP_MAX_FILES);
    expect(sent).not.toContain(`f${MOCKUP_MAX_FILES}.png`);
    expect(sent).not.toContain(`f${MOCKUP_MAX_FILES + 1}.png`);
  });

  it("rejects files past the 100 MB import total and does not send them", async () => {
    expect(MOCKUP_MAX_TOTAL_BYTES).toBe(100 * MB);
    const calls = stubFetch();
    // 5 × 19 MB = 95 MB fit; the sixth crosses 100 MB; a 4 MB one still fits
    const files = [
      ...Array.from({ length: 6 }, (_, i) => makeFile(`big${i}.png`, { size: 19 * MB })),
      makeFile("small.png", { size: 4 * MB }),
    ];
    renderDialog(files);

    const all = rows();
    for (const row of all.slice(0, 5)) {
      expect(within(row).queryByTestId("mockup-import-rejected")).toBeNull();
    }
    expect(within(all[5]).getByTestId("mockup-import-rejected").textContent).toBe(
      "Rejected — Over the 100 MB per-import total — import it separately",
    );
    expect(within(all[6]).queryByTestId("mockup-import-rejected")).toBeNull();
    expect(screen.getByTestId("mockup-import-confirm").textContent).toBe("Import 6");

    await clickConfirm();
    const sent = calls.importBodies[0].getAll("files").map((f) => (f as File).name);
    expect(sent).not.toContain("big5.png");
    expect(sent).toContain("small.png");
  });

  it("shows the server's date as the prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/mockups/today"))
          return { ok: true, json: async () => ({ date: "2026-10-08" }) } as Response;
        return { ok: true, json: async () => ({ files: [] }) } as Response;
      }),
    );
    renderDialog([makeFile("a.png")]);

    await waitFor(() =>
      expect(screen.getByTestId("mockup-import-prefix").textContent).toBe("2026-10-08-"),
    );
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/projects/pavilio/mockups/today",
      expect.anything(),
    );
  });

  it("holds Import while the server's date is pending and shows no concrete date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input).endsWith("/mockups/today")
          ? new Promise<Response>(() => {})
          : Promise.resolve({ ok: true, json: async () => ({ files: [] }) } as Response),
      ),
    );
    renderDialog([makeFile("a.png")]);

    const prefix = screen.getByTestId("mockup-import-prefix");
    // Not the browser's date: it may not be the one the server saves with.
    expect(prefix.textContent).toBe("YYYY-MM-DD-");
    expect(prefix.getAttribute("title")).toBe("Date is set by the server");
    expect((screen.getByTestId("mockup-import-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a placeholder date and still imports when the server's date fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith("/mockups/today"))
          return { ok: false, json: async () => ({}) } as Response;
        return {
          ok: true,
          json: async () => ({
            files: [{ name: "a.png", relativePath: "pavilio/mockups/2026-10-07-a.png", ok: true }],
          }),
        } as Response;
      }),
    );
    const { onImported } = renderDialog([makeFile("a.png")]);

    await clickConfirm();
    expect(screen.getByTestId("mockup-import-prefix").textContent).toBe("YYYY-MM-DD-");
    // The saved name comes from the server's answer, not the placeholder.
    expect(onImported).toHaveBeenCalledWith(["pavilio/mockups/2026-10-07-a.png"]);
  });

  it("re-checks the date on confirm and stops when it changed", async () => {
    // Opened before the server's midnight, confirmed after it.
    const calls = stubFetch({ serverDates: ["2026-10-07", "2026-10-08"] });
    const { onImported } = renderDialog([makeFile("a.png")]);
    await waitFor(() =>
      expect(screen.getByTestId("mockup-import-prefix").textContent).toBe("2026-10-07-"),
    );

    await clickConfirm();
    // Nothing is sent under a name the dialog did not show…
    expect(calls.importBodies).toHaveLength(0);
    expect(onImported).not.toHaveBeenCalled();
    // …the new date is shown, and the user is told to check and confirm again.
    expect(screen.getByTestId("mockup-import-prefix").textContent).toBe("2026-10-08-");
    const alerts = getAlertsSnapshot();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("warning");
    expect(alerts[0].detail).toContain("2026-10-08");

    await clickConfirm();
    expect(calls.importBodies).toHaveLength(1);
  });

  it("sends one import however fast confirm is clicked", async () => {
    const calls = stubFetch();
    renderDialog([makeFile("a.png")]);

    await clickConfirm(2);
    expect(calls.importBodies).toHaveLength(1);
  });

  it("aborts a pending inspect when the import starts", async () => {
    const signals: Record<string, AbortSignal | undefined> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/mockups/inspect")) {
          signals.inspect = init?.signal ?? undefined;
          return new Promise<Response>(() => {});
        }
        return Promise.resolve({ ok: true, json: async () => ({ files: [] }) } as Response);
      }),
    );
    renderDialog([makeFile("page.html")]);
    expect(signals.inspect).toBeDefined();
    expect(signals.inspect!.aborted).toBe(false);

    await clickConfirm();
    expect(signals.inspect!.aborted).toBe(true);
  });

  it("focuses the first name field on open", () => {
    stubFetch();
    renderDialog([makeFile("brief.pdf"), makeFile("a.png"), makeFile("b.png")]);
    expect(document.activeElement).toBe(screen.getAllByTestId("mockup-import-slug")[0]);
  });

  it("focuses the dialog when no file can be named", () => {
    stubFetch();
    renderDialog([makeFile("brief.pdf")]);
    expect(document.activeElement).toBe(screen.getByTestId("mockup-import-dialog"));
  });

  it("keeps Tab inside the dialog", async () => {
    stubFetch();
    renderDialog([makeFile("a.png")]);
    const slug = screen.getByTestId("mockup-import-slug");
    const confirm = screen.getByTestId("mockup-import-confirm") as HTMLButtonElement;
    // Import is the last stop once the server's date is in.
    await waitFor(() => expect(confirm.disabled).toBe(false));

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(slug);

    fireEvent.keyDown(slug, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("restores focus to the opener on close", () => {
    stubFetch();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <MockupImportDialog
        project="pavilio"
        files={[makeFile("a.png")]}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("escape closes the dialog without reaching other key handlers", () => {
    stubFetch();
    const outerReact = vi.fn();
    const windowBubble = vi.fn();
    window.addEventListener("keydown", windowBubble);
    const onClose = vi.fn();
    render(
      <div onKeyDown={outerReact}>
        <MockupImportDialog
          project="pavilio"
          files={[makeFile("a.png")]}
          onClose={onClose}
          onImported={vi.fn()}
        />
      </div>,
    );

    fireEvent.keyDown(screen.getByTestId("mockup-import-slug"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outerReact).not.toHaveBeenCalled();
    expect(windowBubble).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowBubble);
  });

  it("cannot be closed while an import is in flight", async () => {
    let finish!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        if (!String(input).endsWith("/mockups/import"))
          return Promise.resolve({ ok: true, json: async () => ({ files: [] }) } as Response);
        return new Promise<Response>((resolve) => {
          finish = () =>
            resolve({
              ok: true,
              json: async () => ({
                files: [{ name: "a.png", relativePath: "pavilio/mockups/a.png", ok: true }],
              }),
            } as Response);
        });
      }),
    );
    const { onClose, onImported } = renderDialog([makeFile("a.png")]);

    await clickConfirm();
    const confirm = screen.getByTestId("mockup-import-confirm") as HTMLButtonElement;
    expect(confirm.textContent).toBe("Importing…");
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(confirm.disabled).toBe(true);
    expect((screen.getByTestId("mockup-import-cancel") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(screen.getByTestId("mockup-import-slug"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("mockup-import-backdrop"));
    fireEvent.click(screen.getByTestId("mockup-import-cancel"));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      finish();
    });
    expect(onImported).toHaveBeenCalledWith(["pavilio/mockups/a.png"]);
  });

  it("cancel closes without uploading", () => {
    const calls = stubFetch();
    const { onClose } = renderDialog([makeFile("Frame 12.png")]);

    fireEvent.click(screen.getByTestId("mockup-import-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(calls.importBodies).toHaveLength(0);
  });
});

describe("MockupImportDialog lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revokes object URLs on unmount", () => {
    stubFetch();
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:one"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revoke,
    });
    const { unmount } = render(
      <MockupImportDialog
        project="pavilio"
        files={[makeFile("a.png")]}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:one");
  });

  it("aborts a pending inspect when the dialog closes", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/mockups/inspect")) {
          signal = init?.signal ?? undefined;
          return new Promise<Response>(() => {});
        }
        return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
      }),
    );
    const { unmount } = render(
      <MockupImportDialog
        project="pavilio"
        files={[makeFile("icon.svg")]}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
