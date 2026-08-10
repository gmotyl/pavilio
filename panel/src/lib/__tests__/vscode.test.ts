import { describe, it, expect, vi, beforeEach } from "vitest";

describe("vscodeUrlFor", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("routes through Remote-WSL when the server reports a WSL distro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ wslDistro: "Ubuntu" }) }),
    );
    const { vscodeUrlFor } = await import("../vscode");

    const url = await vscodeUrlFor("/root/git/prv/projects/notes/foo.md");

    expect(url).toBe("vscode://vscode-remote/wsl+Ubuntu/root/git/prv/projects/notes/foo.md");
  });

  it("falls back to plain file:// when there is no WSL distro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ wslDistro: null }) }),
    );
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

  it("caches the /api/system lookup across calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ wslDistro: "Ubuntu" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { vscodeUrlFor } = await import("../vscode");

    await vscodeUrlFor("/root/a.md");
    await vscodeUrlFor("/root/b.md");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("openInVSCode", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens the resolved URL via window.open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ wslDistro: "Ubuntu" }) }),
    );
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
