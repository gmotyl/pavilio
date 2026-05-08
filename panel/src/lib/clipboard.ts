// Clipboard helper with a non-secure-context fallback.
//
// `navigator.clipboard.writeText` only works in a "secure context" — HTTPS
// or http://localhost. Over plain HTTP on a LAN IP (e.g. http://192.168.x.y)
// the call throws, so we fall back to the legacy `document.execCommand("copy")`
// approach via a hidden textarea. Keep the modern path first because it
// works asynchronously and doesn't rely on the deprecated API.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
