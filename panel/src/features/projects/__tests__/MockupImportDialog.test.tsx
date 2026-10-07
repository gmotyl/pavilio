import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import MockupImportDialog from "../MockupImportDialog";
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
}: {
  externalCounts?: Record<string, number>;
  importResult?: (names: string[]) => Array<{
    name: string;
    relativePath: string;
    ok: boolean;
    error?: string;
  }>;
} = {}): Calls {
  const calls: Calls = { inspect: [], importBodies: [] };
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
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
    expect(within(png).getByTestId("mockup-import-prefix").textContent).toBe("2026-10-07-");
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

    await act(async () => {
      fireEvent.click(screen.getByTestId("mockup-import-confirm"));
    });

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

    await act(async () => {
      fireEvent.click(screen.getByTestId("mockup-import-confirm"));
    });

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
    await act(async () => {
      fireEvent.click(screen.getByTestId("mockup-import-confirm"));
    });
    expect(calls.importBodies[0].getAll("slugs")).toEqual(["Account Details / Mobile!!"]);
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
});
