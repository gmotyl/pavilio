import { describe, it, expect, vi } from "vitest";
import { bulkCloseTargets, killEach } from "../bulkCloseTargets";

const strip = [
  { id: "a", project: "motyl" },
  { id: "b", project: "motyl" },
  { id: "c", project: "woozle" },
];

describe("bulkCloseTargets", () => {
  it("close others targets strip minus session including minimised", () => {
    // The strip prop holds every session of the surface, minimised ones too.
    expect(bulkCloseTargets(strip, "b", "others")).toEqual(["a", "c"]);
  });

  it("close all on the global view targets every session", () => {
    expect(bulkCloseTargets(strip, "a", "all")).toEqual(["a", "b", "c"]);
  });
});

describe("killEach", () => {
  it("returns the ids whose kill failed, after trying every one", async () => {
    const kill = vi.fn(async (id: string) => {
      if (id === "b") return false;
      if (id === "c") throw new Error("boom");
      return true;
    });
    expect(await killEach(["a", "b", "c", "d"], kill)).toEqual(["b", "c"]);
    expect(kill).toHaveBeenCalledTimes(4);
  });
});
