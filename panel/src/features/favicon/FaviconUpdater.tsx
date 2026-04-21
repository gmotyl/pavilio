import { useEffect } from "react";
import { useAggregateActivity } from "./useAggregateActivity";
import { buildFaviconDataUrl } from "./faviconSvg";

function ensureLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

export function FaviconUpdater() {
  const state = useAggregateActivity();

  useEffect(() => {
    const link = ensureLink();
    link.type = "image/svg+xml";
    link.href = buildFaviconDataUrl(state);
  }, [state]);

  return null;
}
