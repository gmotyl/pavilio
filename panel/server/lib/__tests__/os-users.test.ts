import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Partial-mock "node:fs", overriding only readFileSync. This project's vite
// config sets `legacy.inconsistentCjsInterop`, which routes a named import
// like os-users.ts's `import { readFileSync } from "node:fs"` through the
// mock's `default` property rather than its top-level one — so the override
// has to land in both places, or the real (unmocked) fn is what a module
// other than this test file ends up calling.
vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  const readFileSync = vi.fn();
  return {
    ...actual,
    readFileSync,
    default: {
      ...(actual as unknown as { default: object }).default,
      readFileSync,
    },
  };
});

import { readFileSync } from "node:fs";
import {
  parsePasswd,
  listOsUsers,
  hostSpawnKind,
  _resetOsUsersCacheForTests,
} from "../os-users";

const readFileSyncMock = vi.mocked(readFileSync);

describe("os-users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetOsUsersCacheForTests();
  });

  afterEach(() => {
    delete process.env.WSL_DISTRO_NAME;
  });

  describe("parsePasswd", () => {
    it("parsePasswd includes a uid>=1000 entry with a real shell", () => {
      const content = "greg:x:1000:1000:Greg:/home/greg:/bin/zsh\n";
      expect(parsePasswd(content)).toEqual([
        { username: "greg", homeDir: "/home/greg", shell: "/bin/zsh" },
      ]);
    });

    it("parsePasswd excludes a system entry with uid below 1000", () => {
      const content = "sync:x:4:65534:sync:/bin:/bin/sync\n";
      expect(parsePasswd(content)).toEqual([]);
    });

    it("parsePasswd includes root (uid 0) despite being below 1000", () => {
      // root is the one uid<1000 account worth offering: it's the
      // panel-owner account itself on most setups, so `runAsUser: "root"`
      // must resolve to a real discovered user for the owner-equality check
      // in terminal-manager.ts to recognize it as "no wrapper needed"
      // instead of silently falling back to an unknown-user direct spawn.
      const content = "root:x:0:0:root:/root:/bin/bash\n";
      expect(parsePasswd(content)).toEqual([
        { username: "root", homeDir: "/root", shell: "/bin/bash" },
      ]);
    });

    it("parsePasswd still excludes root if its shell is a non-login one", () => {
      const content = "root:x:0:0:root:/root:/usr/sbin/nologin\n";
      expect(parsePasswd(content)).toEqual([]);
    });

    it("parsePasswd excludes nologin and false shells regardless of uid", () => {
      const content = [
        "svc-a:x:1001:1001:Svc A:/home/svc-a:/usr/sbin/nologin",
        "svc-b:x:1002:1002:Svc B:/home/svc-b:/sbin/nologin",
        "svc-c:x:1003:1003:Svc C:/home/svc-c:/bin/false",
        "svc-d:x:1004:1004:Svc D:/home/svc-d:/usr/bin/false",
      ].join("\n");
      expect(parsePasswd(content)).toEqual([]);
    });

    it("parsePasswd skips blank lines and comment lines", () => {
      const content = [
        "# a comment",
        "",
        "greg:x:1000:1000:Greg:/home/greg:/bin/zsh",
        "",
      ].join("\n");
      expect(() => parsePasswd(content)).not.toThrow();
      expect(parsePasswd(content)).toEqual([
        { username: "greg", homeDir: "/home/greg", shell: "/bin/zsh" },
      ]);
    });
  });

  describe("listOsUsers", () => {
    it("listOsUsers reads /etc/passwd only once across repeated calls", () => {
      readFileSyncMock.mockReturnValue(
        "greg:x:1000:1000:Greg:/home/greg:/bin/zsh\n",
      );
      listOsUsers();
      listOsUsers();
      listOsUsers();
      expect(readFileSyncMock).toHaveBeenCalledTimes(1);
      expect(readFileSyncMock).toHaveBeenCalledWith("/etc/passwd", "utf8");
    });

    it("listOsUsers returns an empty array and does not throw when /etc/passwd is unreadable", () => {
      readFileSyncMock.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(() => listOsUsers()).not.toThrow();
      expect(listOsUsers()).toEqual([]);
      // the failed read is cached too — no retry on the next call.
      expect(readFileSyncMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("hostSpawnKind", () => {
    it("hostSpawnKind reflects WSL_DISTRO_NAME", () => {
      process.env.WSL_DISTRO_NAME = "Ubuntu";
      expect(hostSpawnKind()).toBe("wsl");

      delete process.env.WSL_DISTRO_NAME;
      expect(hostSpawnKind()).toBe("posix");
    });
  });
});
