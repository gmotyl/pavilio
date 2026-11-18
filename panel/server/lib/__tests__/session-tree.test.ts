import { describe, it, expect, vi } from "vitest";

const exec = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: exec.fn }));

import { parsePsTable, descendants, readProcessTable } from "../session-tree.js";

describe("session-tree", () => {
  

  it("parsePsTable reads padded rows and skips blank lines", () => {
    const table = parsePsTable("  10     1\n\n  11    10\n   12   10\n\n");
    expect(table.get(1)).toEqual([10]);
    expect(table.get(10)).toEqual([11, 12]);
    expect(table.size).toBe(2);
  });

  it("descendants returns the root and every transitive child only", () => {
    const table = parsePsTable("2 1\n3 2\n4 3\n9 8\n");
    expect(descendants(1, table)).toEqual(new Set([1, 2, 3, 4]));
  });

  it("descendants of an unknown root is the root alone", () => {
    expect(descendants(99, parsePsTable("2 1\n"))).toEqual(new Set([99]));
  });

  it("descendants survives a parent cycle", () => {
    const table = parsePsTable("2 1\n1 2\n");
    expect(descendants(1, table)).toEqual(new Set([1, 2]));
  });

  it("readProcessTable returns an empty table when ps fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    exec.fn.mockImplementation(() => {
      throw new Error("no ps");
    });
    const first = readProcessTable();
    const second = readProcessTable();
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
