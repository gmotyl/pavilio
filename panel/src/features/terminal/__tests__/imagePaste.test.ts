import { describe, it, expect, vi } from "vitest";
import { imageFromClipboardItems, uploadPastedImage } from "../imagePaste";

function fakeItem(kind: string, type: string, file: File | null): DataTransferItem {
  return { kind, type, getAsFile: () => file } as unknown as DataTransferItem;
}

function fakeItems(...items: DataTransferItem[]): DataTransferItemList {
  return items as unknown as DataTransferItemList;
}

describe("imageFromClipboardItems", () => {
  it("returns the first image file item", () => {
    const img = new File(["x"], "shot.png", { type: "image/png" });
    const items = fakeItems(
      fakeItem("string", "text/html", null),
      fakeItem("file", "image/png", img),
    );
    expect(imageFromClipboardItems(items)).toBe(img);
  });

  it("returns null when there is no image", () => {
    const items = fakeItems(fakeItem("string", "text/plain", null));
    expect(imageFromClipboardItems(items)).toBeNull();
    expect(imageFromClipboardItems(undefined)).toBeNull();
  });
});

describe("uploadPastedImage", () => {
  it("POSTs the image and returns the saved path", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/tmp/pavilio-pastes/paste-1.png" }),
    });
    const img = new File(["x"], "shot.png", { type: "image/png" });

    const path = await uploadPastedImage(img, "sess-1", fetchFn as unknown as typeof fetch);

    expect(path).toBe("/tmp/pavilio-pastes/paste-1.png");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/terminal/paste-image");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("returns null on server error or network failure", async () => {
    const img = new File(["x"], "shot.png", { type: "image/png" });
    const bad = vi.fn().mockResolvedValue({ ok: false });
    expect(await uploadPastedImage(img, "sess-1", bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn().mockRejectedValue(new Error("net"));
    expect(await uploadPastedImage(img, "sess-1", boom as unknown as typeof fetch)).toBeNull();
  });
});

describe("uploadPastedImage session attribution", () => {
  it("POSTs the image with its target session id", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/tmp/pavilio-pastes/paste-1.png" }),
    });
    const img = new File(["x"], "shot.png", { type: "image/png" });

    await uploadPastedImage(img, "sess-42", fetchFn as unknown as typeof fetch);

    const [, init] = fetchFn.mock.calls[0];
    const form = init.body as FormData;
    // The server chowns the saved file to the OS user behind this session,
    // so the upload has to name the terminal it is being pasted into.
    expect(form.get("sessionId")).toBe("sess-42");
    expect(form.get("image")).toBeInstanceOf(File);
  });
});
