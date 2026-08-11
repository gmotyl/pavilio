import { describe, it, expect, vi, beforeEach } from "vitest";

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("vscodeUrlFor", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("routes through Remote-WSL when the server reports a WSL distro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ wslDistro: "Ubuntu" })));
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/root/git/prv/projects/notes/foo.md");

    expect(url).toBe("vscode://vscode-remote/wsl+Ubuntu/root/git/prv/projects/notes/foo.md");
  });

  it("falls back to plain file:// when there is no WSL distro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ wslDistro: null })));
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/Users/greg/git/prv/projects/notes/foo.md");

    expect(url).toBe("vscode://file//Users/greg/git/prv/projects/notes/foo.md");
  });

  it("falls back to plain file:// when the /api/system request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/root/git/prv/projects/notes/foo.md");

    expect(url).toBe("vscode://file//root/git/prv/projects/notes/foo.md");
  });

  it("falls back to plain file:// on a non-OK response instead of parsing it", async () => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json }));
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/root/git/prv/projects/notes/foo.md");

    expect(url).toBe("vscode://file//root/git/prv/projects/notes/foo.md");
    expect(json).not.toHaveBeenCalled();
  });

  it("falls back to plain file:// when the payload has no usable wslDistro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ wslDistro: 42 })));
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/root/git/prv/projects/notes/foo.md");

    expect(url).toBe("vscode://file//root/git/prv/projects/notes/foo.md");
  });

  it("gives up on a hung /api/system via an abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ wslDistro: "Ubuntu" }));
    vi.stubGlobal("fetch", fetchMock);
    const { vscodeUrlFor } = await import("../vscode");

    await vscodeUrlFor("/root/a.md");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/system",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("caches the /api/system lookup across calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ wslDistro: "Ubuntu" }));
    vi.stubGlobal("fetch", fetchMock);
    const { vscodeUrlFor } = await import("../vscode");

    await vscodeUrlFor("/root/a.md");
    await vscodeUrlFor("/root/b.md");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches a 'not WSL' answer too", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ wslDistro: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { vscodeUrlFor } = await import("../vscode");

    await vscodeUrlFor("/root/a.md");
    await vscodeUrlFor("/root/b.md");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-probes after a failure rather than caching the fallback forever", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("server still starting"))
      .mockResolvedValue(okJson({ wslDistro: "Ubuntu" }));
    vi.stubGlobal("fetch", fetchMock);
    const { vscodeUrlFor } = await import("../vscode");

    expect(await vscodeUrlFor("/root/a.md")).toBe("vscode://file//root/a.md");
    expect(await vscodeUrlFor("/root/a.md")).toBe(
      "vscode://vscode-remote/wsl+Ubuntu/root/a.md",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("percent-encodes spaces, '#' and non-ASCII in the path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ wslDistro: "Ubuntu" })));
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/root/My Project/notes #1 (100%) żółw.md");

    expect(url).toBe(
      "vscode://vscode-remote/wsl+Ubuntu/root/My%20Project/notes%20%231%20(100%25)%20%C5%BC%C3%B3%C5%82w.md",
    );
  });

  it("encodes the path on the non-WSL branch too, keeping '/' and ':' literal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ wslDistro: null })));
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/Users/greg/My Notes/a?b.md");

    expect(url).toBe("vscode://file//Users/greg/My%20Notes/a%3Fb.md");
  });
});

describe("openInVSCode", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens the resolved URL via window.open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ wslDistro: "Ubuntu" })));
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { openInVSCode } = await import("../vscode");

    await openInVSCode("/root/git/prv/projects/notes/foo.md");

    expect(openSpy).toHaveBeenCalledWith(
      "vscode://vscode-remote/wsl+Ubuntu/root/git/prv/projects/notes/foo.md",
      "_self",
    );
    openSpy.mockRestore();
  });
});
