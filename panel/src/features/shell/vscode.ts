// Opens an absolute path in VS Code via the `vscode://` protocol handler.
//
// Plain `vscode://file/<absolute-path>` breaks when the panel's server runs
// inside WSL and the browser opening the link is the Windows host: VS Code's
// URI parser turns the leading path segment into a UNC hostname (e.g.
// `/root/git/...` → the bogus share `\\root\git\...`, since `//root/...` is
// exactly the shape of a UNC path). "Path does not exist" follows.
//
// Fix: when the server tells us it's WSL, route through the Remote-WSL
// extension instead (`vscode://vscode-remote/wsl+<distro><path>`) — the same
// scheme VS Code's own `code` CLI uses when invoked from inside a distro.
// That resolves the path inside the distro directly, sidestepping Windows
// path translation entirely. Non-WSL setups (e.g. a native macOS install)
// keep the original `vscode://file/` link.
const SYSTEM_FETCH_TIMEOUT_MS = 2000;

// Cached for the session — the distro cannot change under a running server.
// Only a *resolved* answer is cached, including the "not WSL" null: a failed
// probe must not condemn every later click to the fallback, since the usual
// cause is the panel server still coming up.
let wslDistroPromise: Promise<string | null> | null = null;

function fetchWslDistro(): Promise<string | null> {
  if (!wslDistroPromise) {
    wslDistroPromise = fetch("/api/system", {
      signal: AbortSignal.timeout(SYSTEM_FETCH_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`/api/system responded ${res.status}`);
        return res.json();
      })
      .then((data) => (typeof data?.wslDistro === "string" ? data.wslDistro : null))
      .catch(() => {
        wslDistroPromise = null; // let the next click probe again
        return null;
      });
  }
  return wslDistroPromise;
}

// Percent-encode the path so spaces, `#`, `?`, `%` and non-ASCII survive the
// round-trip into VS Code's URI parser. `encodeURI` alone is not enough — it
// leaves `#` and `?` intact, and a `#` would truncate the path at the fragment
// (`/notes #1.md` → `/notes `). `/` and `:` stay literal: both are structural
// here (path separators, and the `C:` in a Windows-side path).
function encodePath(absolutePath: string): string {
  return encodeURI(absolutePath).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

export async function vscodeUrlFor(absolutePath: string): Promise<string> {
  const distro = await fetchWslDistro();
  const path = encodePath(absolutePath);
  return distro
    ? `vscode://vscode-remote/wsl+${encodeURIComponent(distro)}${path}`
    : `vscode://file/${path}`;
}

export async function openInVSCode(absolutePath: string): Promise<void> {
  window.open(await vscodeUrlFor(absolutePath), "_self");
}
