import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFavorites } from "../useFavorites";

describe("useFavorites", () => {
  it("starts with empty favorites", () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites.size).toBe(0);
  });

  it("toggles a favorite on and off", () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle("my-work"));
    expect(result.current.isFavorite("my-work")).toBe(true);
    act(() => result.current.toggle("my-work"));
    expect(result.current.isFavorite("my-work")).toBe(false);
  });

  it("persists to localStorage", () => {
    const { result, unmount } = renderHook(() => useFavorites());
    act(() => result.current.toggle("my-blog"));
    unmount();

    const { result: result2 } = renderHook(() => useFavorites());
    expect(result2.current.isFavorite("my-blog")).toBe(true);
  });

  it("sortWithFavorites puts favorites first", () => {
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle("my-pet-project"));

    const items = [{ name: "my-work" }, { name: "my-pet-project" }, { name: "my-blog" }];
    const sorted = result.current.sortWithFavorites(items);
    expect(sorted[0].name).toBe("my-pet-project");
    expect(sorted.length).toBe(3);
  });
});
