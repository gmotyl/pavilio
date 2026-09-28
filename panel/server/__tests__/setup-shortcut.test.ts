import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * scripts/setup:shortcut derives the launcher path from its own location, so
 * every case here runs a *copy* of it out of <sandbox>/repo/scripts/ next to a
 * stand-in start-panel-windows.sh. The assertion about the absolute launcher
 * path is then about the sandbox, never about the developer's own checkout.
 *
 * Nothing here may see the host: the script gets an environment built from
 * scratch (no process.env) and a PATH holding only sandbox stub dirs. That
 * matters twice over — this suite also runs *inside* WSL, where a real
 * powershell.exe is on PATH and would happily write a shortcut onto the real
 * Desktop, and where a real wslpath would answer the conversion. It also means
 * scripts/setup:shortcut must not reach for coreutils: with this PATH there are
 * none.
 */

const SETUP_SHORTCUT = resolve(__dirname, "../../../scripts/setup:shortcut");
const REPO_ROOT = resolve(__dirname, "../../..");

// Absolute, because the script runs on a PATH that could not resolve `bash`.
const BASH =
  spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim() || "/bin/bash";

/** What the stub powershell.exe answers with, i.e. what the real Save() wrote. */
const WINDOWS_LNK = "C:\\Users\\greg\\Desktop\\Pavilio Panel.lnk";
/** What the stub wslpath answers with for that path. */
const WSL_LNK = "/mnt/c/Users/greg/Desktop/Pavilio Panel.lnk";

const PAYLOAD_SEPARATOR = "---PAYLOAD---";

let sandbox: string;
let repo: string;
let stubBin: string;
let psLog: string;

/**
 * The stub powershell.exe: records every -Command payload and answers on stdout
 * with the path the real CreateShortcut()/Save() would have written.
 */
function writePowershellStub() {
  writeFileSync(
    join(stubBin, "powershell.exe"),
    [
      "#!/bin/sh",
      "# Stub powershell.exe: log the -Command payload, answer with the .lnk path.",
      "while [ $# -gt 0 ]; do",
      '  if [ "$1" = "-Command" ]; then',
      "    shift",
      `    printf '%s\\n${PAYLOAD_SEPARATOR}\\n' "$1" >> "${psLog}"`,
      "  fi",
      "  shift || break",
      "done",
      `printf '%s\\n' '${WINDOWS_LNK}'`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

/** The stub wslpath: only the -u conversion the script asks for. */
function writeWslpathStub() {
  writeFileSync(
    join(stubBin, "wslpath"),
    ["#!/bin/sh", "# Stub wslpath: answer the -u conversion with a fixed POSIX path.", `printf '%s\\n' '${WSL_LNK}'`, ""].join(
      "\n",
    ),
    { mode: 0o755 },
  );
}

function run(extraEnv: Record<string, string> = {}, repoDir: string = repo) {
  const res = spawnSync(BASH, [join(repoDir, "scripts", "setup:shortcut")], {
    encoding: "utf8",
    env: { HOME: join(sandbox, "home"), PATH: stubBin, ...extraEnv },
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

/**
 * Plant a second sandbox checkout under `dirName`, so a case can put the repo
 * behind a directory name the quoting has to survive.
 */
function makeRepoUnder(dirName: string): string {
  const other = join(sandbox, dirName, "repo");
  mkdirSync(join(other, "scripts"), { recursive: true });
  copyFileSync(SETUP_SHORTCUT, join(other, "scripts", "setup:shortcut"));
  // This launcher is actually executed by the quoting test, so it does
  // something observable rather than nothing.
  writeFileSync(
    join(other, "scripts", "start-panel-windows.sh"),
    // An absolute interpreter and a builtin only: PATH here holds stubs alone.
    ["#!/bin/sh", `printf 'launched\\n' > "${join(sandbox, "launched")}"`, ""].join("\n"),
    { mode: 0o755 },
  );
  return other;
}

/**
 * The value assigned to $shortcut.Arguments, as PowerShell would see it after
 * parsing its single-quoted literal. Throws when the literal is terminated
 * early — i.e. exactly the failure an un-escaped apostrophe causes.
 */
function windowsArguments(payload: string): string {
  const line = payload.split("\n").find((l) => l.startsWith("$shortcut.Arguments"));
  expect(line, "payload has no $shortcut.Arguments assignment").toBeTruthy();
  const body = (line as string).slice((line as string).indexOf("=") + 1).trim();
  expect(body.startsWith("'") && body.endsWith("'")).toBe(true);
  const inner = body.slice(1, -1);
  // Inside a PowerShell single-quoted string a literal ' is written ''. Any
  // odd one out would have ended the string at that point.
  expect(inner.replace(/''/g, ""), "PowerShell literal terminated early").not.toContain("'");
  return inner.replace(/''/g, "'");
}

/** The -Command payloads the stub recorded, newest last. */
function payloads(): string[] {
  if (!existsSync(psLog)) return [];
  return readFileSync(psLog, "utf8")
    .split(`${PAYLOAD_SEPARATOR}\n`)
    .filter((p) => p.trim().length > 0);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "setup-shortcut-"));
  repo = join(sandbox, "repo");
  stubBin = join(sandbox, "bin");
  psLog = join(sandbox, "powershell.log");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(sandbox, "home"), { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  copyFileSync(SETUP_SHORTCUT, join(repo, "scripts", "setup:shortcut"));
  // The launcher the shortcut must point at — only its path is ever read.
  writeFileSync(join(repo, "scripts", "start-panel-windows.sh"), "#!/usr/bin/env bash\n", {
    mode: 0o755,
  });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scripts/setup:shortcut", () => {
  it("writes a shortcut whose arguments pin the distro and the absolute launcher path", () => {
    writePowershellStub();
    writeWslpathStub();

    const { status, output } = run({ WSL_DISTRO_NAME: "Ubuntu-24.04" });

    expect(status).toBe(0);

    const recorded = payloads();
    expect(recorded).toHaveLength(1);
    const payload = recorded[0];

    // wsl.exe is the target, launched from a directory that always exists.
    expect(payload).toContain("$shortcut.TargetPath = 'C:\\Windows\\System32\\wsl.exe'");
    expect(payload).toContain("$shortcut.IconLocation = 'C:\\Windows\\System32\\wsl.exe,0'");
    // Asserted on its own line: a bare toContain("C:\\Windows\\System32") is
    // already satisfied by TargetPath, so deleting this line from the script
    // would not have been noticed.
    expect(payload).toContain("$shortcut.WorkingDirectory = 'C:\\Windows\\System32'");
    // The distro is pinned, and the launcher is named by absolute path — a
    // relative one would resolve against wsl.exe's working directory.
    const launcher = join(repo, "scripts", "start-panel-windows.sh");
    expect(windowsArguments(payload)).toBe(`~ -d "Ubuntu-24.04" -- bash -lc "'${launcher}'"`);

    // And the user is told where it landed, in a path they can act on.
    expect(output).toContain(WSL_LNK);
  }, 30000);

  it("targets the Windows Desktop folder via GetFolderPath so OneDrive redirection is honoured", () => {
    writePowershellStub();

    const first = run({ WSL_DISTRO_NAME: "Ubuntu-24.04" });
    expect(first.status).toBe(0);

    // A hardcoded %USERPROFILE%\Desktop misses a OneDrive-redirected Desktop.
    const payload = payloads()[0];
    expect(payload).toContain("GetFolderPath('Desktop')");
    expect(payload).toContain("'Pavilio Panel.lnk'");
    expect(payload).not.toMatch(/USERPROFILE/);

    // Run twice: the same file is overwritten, never a second suffixed copy.
    const second = run({ WSL_DISTRO_NAME: "Ubuntu-24.04" });
    expect(second.status).toBe(0);

    const both = payloads();
    expect(both).toHaveLength(2);
    expect(both[1]).toBe(both[0]);

    // Without wslpath on PATH the Windows spelling is printed rather than
    // nothing at all.
    expect(second.output).toContain(WINDOWS_LNK);
  }, 30000);

  it("is skipped outside WSL", () => {
    // No powershell.exe on PATH at all: a plain Linux or macOS checkout.
    const noPowershell = run({ WSL_DISTRO_NAME: "Ubuntu-24.04" });

    expect(noPowershell.status).toBe(0);
    expect(noPowershell.output).toContain("skipped (not WSL)");
    expect(payloads()).toHaveLength(0);

    // powershell.exe reachable but no distro name: not a WSL shell either.
    writePowershellStub();
    const noDistro = run();

    expect(noDistro.status).toBe(0);
    expect(noDistro.output).toContain("skipped (not WSL)");
    expect(payloads()).toHaveLength(0);
  }, 30000);

  it("survives a checkout path holding both a space and an apostrophe", () => {
    writePowershellStub();

    // "C:\Users\Greg O'Brien Motyl\pavilio" is an ordinary Windows home. The
    // apostrophe used to close the PowerShell literal early (parse error, no
    // shortcut at all) and the space used to split the `bash -lc` argument
    // (shortcut written, exit 0, "No such file or directory" on every click).
    const awkward = makeRepoUnder("Greg O'Brien Motyl");
    const launcher = join(awkward, "scripts", "start-panel-windows.sh");
    expect(launcher).toContain("'");
    expect(launcher).toContain(" ");

    const { status } = run({ WSL_DISTRO_NAME: "Ubuntu-24.04" }, awkward);
    expect(status).toBe(0);

    // windowsArguments() throws when the PowerShell literal ends early.
    const args = windowsArguments(payloads()[0]);

    // Windows splits Arguments into argv before wsl.exe sees them, so the
    // command string has to be one double-quoted word with nothing to split on.
    const match = /-- bash -lc (".*")$/.exec(args);
    expect(match, `no quoted bash -lc argument in: ${args}`).toBeTruthy();
    const quoted = (match as RegExpExecArray)[1];
    expect(quoted.slice(1, -1)).not.toContain('"');

    // And what bash is finally handed must run the launcher, not a prefix of it.
    const command = quoted.slice(1, -1);
    const marker = join(sandbox, "launched");
    expect(existsSync(marker)).toBe(false);
    const ran = spawnSync(BASH, ["-c", command], {
      encoding: "utf8",
      env: { HOME: join(sandbox, "home"), PATH: stubBin },
    });
    expect(`${ran.stdout}${ran.stderr}`).toBe("");
    expect(ran.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  }, 30000);

  it("fails loudly when PowerShell cannot write the shortcut", () => {
    // A locked-down Desktop, a broken COM registration, a refused interop call:
    // whatever the reason, setup must not report success.
    writeFileSync(
      join(stubBin, "powershell.exe"),
      ["#!/bin/sh", "# Stub powershell.exe: the Windows side refuses.", "echo 'Access denied' >&2", "exit 1", ""].join(
        "\n",
      ),
      { mode: 0o755 },
    );

    const { status, output } = run({ WSL_DISTRO_NAME: "Ubuntu-24.04" });

    expect(status).toBe(1);
    expect(output).toContain("Could not write the desktop shortcut");
    expect(output).not.toContain("✅");
  }, 30000);

  it("refuses to write a shortcut when the launcher is missing", () => {
    writePowershellStub();
    // Stands in for both an incomplete checkout and the cd that silently failed,
    // which used to leave the shortcut pointing at /start-panel-windows.sh.
    rmSync(join(repo, "scripts", "start-panel-windows.sh"));

    const { status, output } = run({ WSL_DISTRO_NAME: "Ubuntu-24.04" });

    expect(status).toBe(1);
    expect(output).toContain("Launcher not found");
    expect(output).not.toContain("✅");
    // PowerShell is never reached, so nothing lands on the Desktop.
    expect(payloads()).toHaveLength(0);
  }, 30000);

  it("the repository no longer ships a reference .lnk", () => {
    // It was one machine's binary shortcut, stale the moment the repo moved.
    expect(existsSync(join(REPO_ROOT, "scripts", "Pavilio Panel.lnk"))).toBe(false);

    const tracked = spawnSync("git", ["ls-files", "scripts/"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).stdout;
    expect(tracked).not.toContain(".lnk");
    expect(tracked).toContain("scripts/setup:shortcut");
  }, 30000);
});
