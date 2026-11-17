import { describe, expect, it } from "vitest";
import {
  mergeSidebarOrder,
  renameGroupInOrder,
  renameGroupCollapsed,
} from "../sidebarOrder";

const empty = { top: [], groups: {} };

describe("sidebarOrder", () => {
  it("empty order is alphabetical", () => {
    const nodes = mergeSidebarOrder(empty, [
      { name: "zeta", group: null },
      { name: "b2", group: "Beta" },
      { name: "b1", group: "Beta" },
      { name: "alpha", group: null },
      { name: "c", group: "Gamma" },
    ]);
    expect(nodes).toEqual([
      { kind: "project", name: "alpha" },
      { kind: "group", name: "Beta", members: ["b1", "b2"] },
      { kind: "group", name: "Gamma", members: ["c"] },
      { kind: "project", name: "zeta" },
    ]);
  });

  it("stale entries are skipped", () => {
    const nodes = mergeSidebarOrder(
      {
        top: ["p:gone", "g:Old", "p:b", "g:G"],
        groups: { G: ["x", "y"], Old: ["q"] },
      },
      [
        { name: "b", group: null },
        { name: "y", group: "G" },
      ],
    );
    expect(nodes).toEqual([
      { kind: "project", name: "b" },
      { kind: "group", name: "G", members: ["y"] },
    ]);
  });

  it("newcomers append alphabetically", () => {
    const nodes = mergeSidebarOrder(
      { top: ["p:m", "g:G"], groups: { G: ["k"] } },
      [
        { name: "m", group: null },
        { name: "z", group: null },
        { name: "a", group: null },
        { name: "k", group: "G" },
        { name: "c", group: "G" },
        { name: "b", group: "H" },
      ],
    );
    expect(nodes).toEqual([
      { kind: "project", name: "m" },
      { kind: "group", name: "G", members: ["k", "c"] },
      { kind: "project", name: "a" },
      { kind: "group", name: "H", members: ["b"] },
      { kind: "project", name: "z" },
    ]);
  });

  it("current group wins over saved placement", () => {
    const nodes = mergeSidebarOrder(
      { top: ["p:x", "g:G"], groups: { G: ["y"] } },
      [
        { name: "x", group: "G" },
        { name: "y", group: null },
      ],
    );
    expect(nodes).toEqual([
      { kind: "group", name: "G", members: ["x"] },
      { kind: "project", name: "y" },
    ]);
  });

  it("rename moves order and collapse keys", () => {
    const order = {
      top: ["p:a", "g:Old", "g:Other"],
      groups: { Old: ["x", "y"], Other: ["z"] },
    };
    expect(renameGroupInOrder(order, "Old", "New")).toEqual({
      top: ["p:a", "g:New", "g:Other"],
      groups: { New: ["x", "y"], Other: ["z"] },
    });
    expect(order.top).toContain("g:Old");
    expect(
      renameGroupCollapsed({ Old: true, Other: false }, "Old", "New"),
    ).toEqual({
      New: true,
      Other: false,
    });
  });
});
