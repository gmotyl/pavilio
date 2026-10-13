import { describe, expect, it, vi } from "vitest";

/**
 * The test storages installed by `test-setup.ts` must behave like real web
 * Storage: instances with no own methods, inheriting everything from
 * `Storage.prototype`. That is what makes BOTH spy forms work — a suite may
 * spy on the prototype (the form most codebases reach for first) or on the
 * instance, and either spy is actually reached. Until this contract held,
 * a `Storage.prototype` spy was silently inert and tests passed vacuously.
 */
describe("test-setup storage contract", () => {
  it("a Storage.prototype spy is reached through localStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    localStorage.setItem("k", "v");

    expect(setItem).toHaveBeenCalledWith("k", "v");
    // The spy wraps the real implementation, so the write still lands.
    expect(localStorage.getItem("k")).toBe("v");
  });

  it("a Storage.prototype spy is reached through sessionStorage", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");

    sessionStorage.setItem("k", "v");
    const value = sessionStorage.getItem("k");

    expect(getItem).toHaveBeenCalledWith("k");
    expect(value).toBe("v");
  });

  it("an instance spy on localStorage is reached", () => {
    const setItem = vi.spyOn(localStorage, "setItem");

    localStorage.setItem("k", "v");

    expect(setItem).toHaveBeenCalledWith("k", "v");
    expect(localStorage.getItem("k")).toBe("v");
  });

  it("localStorage and sessionStorage are independent", () => {
    localStorage.setItem("k", "v");

    expect(sessionStorage.getItem("k")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(1);
  });

  it("test storage is an instance of Storage", () => {
    expect(localStorage instanceof Storage).toBe(true);
    expect(sessionStorage instanceof Storage).toBe(true);
    // No own methods: every call travels through the prototype, which is
    // exactly why a prototype spy is reached.
    expect(Object.getOwnPropertyNames(localStorage)).toEqual([]);
  });
});
