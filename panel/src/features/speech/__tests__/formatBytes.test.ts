import { describe, expect, it } from "vitest";
import { formatBytes } from "../formatBytes";

describe("formatBytes", () => {
  it("keeps bytes, whole kilobytes and one-decimal megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(212 * 1024)).toBe("212 KB");
    expect(formatBytes(46.3 * 1024 * 1024)).toBe("46.3 MB");
  });

  it("rounds into megabytes rather than showing 1024 KB", () => {
    expect(formatBytes(1024 * 1024 - 100)).toBe("1.0 MB");
    expect(formatBytes(1023.5 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1023.4 * 1024)).toBe("1023 KB");
  });
});
