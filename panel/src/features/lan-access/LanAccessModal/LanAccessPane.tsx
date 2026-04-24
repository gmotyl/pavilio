import { useEffect, useState } from "react";
import { Wifi, RotateCw } from "lucide-react";
import { renderQrSvg } from "../../mobile-access/qr";
import { Toggle } from "../../mobile-access/MobileAccessModal/Toggle";
import { ClickableUrl } from "../../mobile-access/ClickableUrl";
import type { LanChannel, HostInfo } from "../../mobile-access/useMobileAccessStatus";

const HTTPS_ISSUE_URL =
  "https://github.com/gmotyl/pavilio/issues/new?" +
  "title=" + encodeURIComponent("Feature request: HTTPS for LAN access") +
  "&body=" + encodeURIComponent(
    "I'd like HTTPS support for the LAN access channel so session cookies " +
    "aren't transmitted in cleartext on my local network.\n\n" +
    "Context:\n" +
    "- The LAN tab currently serves plain HTTP.\n" +
    "- HTTPS via mkcert requires installing a user-CA on every peer, which " +
    "is impractical on Android (user CAs aren't trusted by apps since " +
    "Android 7) and friction-heavy on iOS.\n\n" +
    "👍 this issue to signal demand.",
  );

export function LanAccessPane({
  lan,
  host,
  onEnable,
  onDisable,
  onRegenerate,
}: {
  lan: LanChannel;
  host?: HostInfo;
  onEnable: () => void;
  onDisable: () => void;
  onRegenerate: () => void;
}) {
  const isOn = lan.state === "on";
  const hasInterface = lan.state === "on" || lan.lanIp !== null;
  const [svg, setSvg] = useState<string>("");
  const [tooltipOpen, setTooltipOpen] = useState(false);

  useEffect(() => {
    if (!isOn) {
      setSvg("");
      return;
    }
    let alive = true;
    renderQrSvg(lan.qrUrl).then((out) => {
      if (alive) setSvg(out);
    });
    return () => {
      alive = false;
    };
  }, [isOn, isOn && lan.qrUrl]);

  return (
    <div className="p-6 pt-7">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            color: isOn ? "var(--accent)" : "var(--text-tertiary)",
          }}
        >
          <Wifi size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[11px] uppercase tracking-[0.18em] mb-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            LAN access
          </div>
          <div
            className="text-base font-medium leading-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {isOn ? "Reachable on your network" : "Not active"}
          </div>
        </div>
        <Toggle
          on={isOn}
          onChange={(next) => (next ? onEnable() : onDisable())}
          label="LAN access"
          size="md"
          disabled={!isOn && !hasInterface}
        />
      </div>

      {/* QR stage */}
      <div
        className="rounded-xl p-4 flex flex-col items-center"
        style={{
          background: "var(--bg-base)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="relative rounded-lg overflow-hidden"
          style={{
            width: 208,
            height: 208,
            background: isOn ? "#ffffff" : "var(--bg-surface)",
            border: isOn
              ? "1px solid var(--border-default)"
              : "1px dashed var(--border-default)",
            transition: "background 200ms, border 200ms",
          }}
        >
          {isOn && svg ? (
            <div
              className="w-full h-full p-2.5"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center text-xs text-center px-6"
              style={{ color: "var(--text-tertiary)" }}
            >
              {isOn
                ? "Generating QR…"
                : hasInterface
                  ? "Toggle on to show LAN link"
                  : "No LAN network detected. Connect to Wi-Fi or Ethernet and try again."}
            </div>
          )}
        </div>

        {isOn ? (
          <>
            <ClickableUrl href={lan.qrUrl} />

            {host?.wsl && (
              <WslPortproxyCallout
                wslVmIp={host.wslVmIp}
                windowsLanIp={lan.lanIp}
                port={portOf(lan.url)}
              />
            )}

            {/* Cleartext warning */}
            <div className="mt-3 w-full px-2">
              <div
                className="flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[11px] leading-snug"
                style={{
                  background: "rgba(234, 179, 8, 0.08)",
                  border: "1px solid rgba(234, 179, 8, 0.25)",
                  color: "var(--text-secondary)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setTooltipOpen((v) => !v)}
                  aria-label="Cleartext warning details"
                  aria-expanded={tooltipOpen}
                  className="shrink-0 mt-[1px] inline-flex items-center justify-center font-bold text-[10px] rounded-[3px]"
                  style={{
                    width: 16,
                    height: 16,
                    background: "rgb(234, 179, 8)",
                    color: "#1a1a1a",
                    cursor: "pointer",
                  }}
                >
                  !
                </button>
                <div className="flex-1">
                  Cleartext over LAN — cookies travel unencrypted.
                </div>
              </div>
              {tooltipOpen && (
                <div
                  className="mt-2 rounded-md px-3 py-2 text-[11px] leading-relaxed"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  The panel reaches peers over plain HTTP on your local
                  network, so session cookies are visible to anyone sniffing
                  traffic there. The pairing token itself stays out of the
                  request (it&apos;s in the URL fragment) — but once paired,
                  the session cookie is exposed.
                  <br />
                  <br />
                  HTTPS on LAN requires installing mkcert&apos;s root CA on
                  every peer device, which is impractical (and, on Android,
                  mostly ineffective for apps).
                  <br />
                  <a
                    href={HTTPS_ISSUE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 underline"
                    style={{ color: "var(--accent)" }}
                  >
                    Request HTTPS support →
                  </a>
                </div>
              )}
            </div>

            <button
              onClick={onRegenerate}
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md transition-colors"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-surface)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <RotateCw size={12} />
              Rotate pairing token
            </button>
            <div
              className="mt-1 text-[10px] text-center px-2"
              style={{ color: "var(--text-muted)" }}
            >
              Invalidates all paired devices (Mobile + LAN).
            </div>
          </>
        ) : (
          <div
            className="mt-3 text-[11px] text-center px-2"
            style={{ color: "var(--text-muted)" }}
          >
            Enabling binds the panel to <code
              className="px-1 py-0.5 rounded"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                fontFamily: "ui-monospace, monospace",
              }}
            >0.0.0.0</code> so other devices on your Wi-Fi / Ethernet can
            reach it. Off by default at every panel start.
          </div>
        )}
      </div>

      {/* Instructions */}
      <ol
        className="mt-5 space-y-1.5 text-[12px] leading-relaxed pl-0"
        style={{
          color: isOn ? "var(--text-secondary)" : "var(--text-muted)",
          counterReset: "step",
        }}
      >
        {[
          "Connect your device to the same Wi-Fi or Ethernet as this machine.",
          "Scan the QR above or tap the link — the panel opens, paired.",
          "If the link doesn't open, your OS firewall may be blocking the port — allow it for this process.",
        ].map((t, i) => (
          <li
            key={i}
            className="flex gap-2.5 items-start"
            style={{ counterIncrement: "step" }}
          >
            <span
              className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold mt-[1px]"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-tertiary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {i + 1}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function portOf(url: string): number {
  try {
    const u = new URL(url);
    return Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  } catch {
    return 3010;
  }
}

function WslPortproxyCallout({
  wslVmIp,
  windowsLanIp,
  port,
}: {
  wslVmIp: string | null;
  windowsLanIp: string;
  port: number;
}) {
  const [copied, setCopied] = useState(false);
  const connectAddr = wslVmIp ?? "<your-WSL-eth0-IP>";
  // Bind the portproxy to the Windows LAN IP specifically — NOT 0.0.0.0 —
  // otherwise the portproxy shadows Windows' own loopback and breaks
  // `http://localhost:<port>` from the Windows host (it also collides with
  // WSL2's native localhost-forwarding relay).
  const script =
    `netsh interface portproxy delete v4tov4 listenport=${port} listenaddress=0.0.0.0\n` +
    `netsh interface portproxy add v4tov4 listenport=${port} listenaddress=${windowsLanIp} connectport=${port} connectaddress=${connectAddr}\n` +
    `New-NetFirewallRule -DisplayName "Pavilio LAN ${port}" -Direction Inbound -LocalPort ${port} -Protocol TCP -Action Allow`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="mt-3 w-full px-2">
      <div
        className="rounded-md px-2.5 py-2 text-[11px] leading-snug"
        style={{
          background: "rgba(59, 130, 246, 0.06)",
          border: "1px solid rgba(59, 130, 246, 0.25)",
          color: "var(--text-secondary)",
        }}
      >
        <div className="mb-1.5">
          <strong>WSL2 detected.</strong> The panel is bound inside the WSL
          VM — LAN peers reach Windows first, which won&apos;t forward to
          WSL by default. Run this once in an <em>admin</em> PowerShell on
          Windows (the first line clears any old overly-broad rule that
          would shadow <code>localhost</code>):
        </div>
        <pre
          className="mt-1 p-2 rounded text-[10px] overflow-auto"
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
            fontFamily: "ui-monospace, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {script}
        </pre>
        <button
          type="button"
          onClick={onCopy}
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
          style={{
            background: copied ? "var(--accent)" : "var(--bg-surface)",
            color: copied ? "#0c0c0f" : "var(--text-secondary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {copied ? "Copied" : "Copy commands"}
        </button>
      </div>
    </div>
  );
}
