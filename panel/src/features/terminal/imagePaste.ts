// Pasting an image into the terminal: the CLI running in the pty can only
// read the clipboard of the machine it runs on, so a cross-machine paste
// (e.g. Mac browser → panel on the PC) has to go through the browser. We
// grab the image from the paste event, upload it to the panel server, and
// paste the saved file's path into the terminal for the CLI to pick up.

/** First image file in a paste event's clipboardData.items, if any. */
export function imageFromClipboardItems(
  items: DataTransferItemList | null | undefined,
): File | null {
  for (const item of Array.from(items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

/** Image blob from the async clipboard API (secure contexts only). */
export async function readClipboardImage(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return await item.getType(type);
    }
  } catch {
    // permission denied or no clipboard access
  }
  return null;
}

/**
 * Upload a pasted image; returns the absolute path it was saved to.
 *
 * The upload names the terminal session it is destined for: the panel server
 * may run as root while the session's pty runs as another OS user, so the
 * server has to know whose file this is before it can chown the saved image
 * to the account that will actually read it.
 */
export async function uploadPastedImage(
  image: Blob,
  sessionId: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const form = new FormData();
  const name = image instanceof File && image.name ? image.name : "paste.png";
  form.append("image", image, name);
  form.append("sessionId", sessionId);
  try {
    const res = await fetchFn("/api/terminal/paste-image", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.path === "string" ? data.path : null;
  } catch {
    return null;
  }
}
