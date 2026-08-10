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
let wslDistroPromise: Promise<string | null> | null = null;

function fetchWslDistro(): Promise<string | null> {
  if (!wslDistroPromise) {
    wslDistroPromise = fetch("/api/system")
      .then((res) => res.json())
      .then((data) => data.wslDistro ?? null)
      .catch(() => null);
  }
  return wslDistroPromise;
}

export async function vscodeUrlFor(absolutePath: string): Promise<string> {
  const distro = await fetchWslDistro();
  return distro
    ? `vscode://vscode-remote/wsl+${distro}${absolutePath}`
    : `vscode://file/${absolutePath}`;
}

export async function openInVSCode(absolutePath: string): Promise<void> {
  window.open(await vscodeUrlFor(absolutePath), "_self");
}
