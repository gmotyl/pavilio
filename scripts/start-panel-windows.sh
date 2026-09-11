#!/usr/bin/env bash
# Pavilio panel launcher for Windows-WSL desktop shortcut.
#
# What it does on every launch:
#   1. starts the panel (`npm start` backgrounds `pnpm -C panel start`, which
#      serves the built bundle from panel/dist — see README "Windows desktop shortcut")
#   2. waits for the panel to come up on 127.0.0.1
#   3. (WSL2 only) ensures the Windows-side `netsh portproxy` entries forward
#      each managed port on the host to the current WSL IP — prompts UAC
#      ONLY if any entry is missing or stale; silent no-op when correct.
#      Managed ports = the panel port + anything in PANEL_EXTRA_PORTS.
#   4. enables LAN access (panel rebinds to 0.0.0.0)
#   5. prints clickable pair links with the current token + LAN IP — paste
#      or Ctrl+click in Windows Terminal to pair the Windows browser
#
# Extra ports: set PANEL_EXTRA_PORTS to a space-separated list to expose
# additional WSL-side services to the LAN through the same UAC-once flow
# (e.g. "3000" for a Vite/Next dev server, "443" for Caddy/nginx fronting
# *.local apps). Per-host config can also be put in an untracked file
# `scripts/start-panel-windows.local.env` (sourced before fixup runs).
#
# Pavilio's pairing token only rotates on explicit user action, so the link
# stays valid across panel restarts. After a rotation, just re-run the
# shortcut to get a fresh link.
#
# Why the portproxy step exists: WSL's localhost-forwarding relay only
# exposes the panel to 127.0.0.1 on the Windows host. To reach the panel
# from a phone or laptop on the same Wi-Fi, Windows needs an explicit
# `netsh portproxy` entry that forwards <hostLanIp>:<port> to <wslIp>:<port>.
# That command requires admin elevation — hence the UAC prompt the first
# time it runs (and again only if Windows ever loses an entry).

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PANEL_PORT="${PANEL_PORT:-3010}"
PANEL_EXTRA_PORTS="${PANEL_EXTRA_PORTS:-}"

# Per-host overrides (untracked, gitignored). Lets users add extra ports
# without editing this upstream-managed script.
if [ -f "${SCRIPT_DIR}/start-panel-windows.local.env" ]; then
  # shellcheck disable=SC1091
  . "${SCRIPT_DIR}/start-panel-windows.local.env"
fi

BASE="http://127.0.0.1:${PANEL_PORT}"

cd "${SCRIPT_DIR}/.."

npm start

echo
printf 'Waiting for panel'
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 1 "${BASE}/api/auth/status"; then
    echo " ready."
    break
  fi
  printf '.'
  sleep 0.5
done

# ---------- WSL2 portproxy self-heal ---------------------------------------
# Only runs when powershell.exe is on PATH (i.e. inside a WSL2 distro on
# Windows). On native Linux/macOS this whole block is skipped.
if command -v powershell.exe >/dev/null 2>&1; then
  # ---------- WSL2 MTU self-heal -------------------------------------------
  # WSL can bring eth0 up with a smaller MTU than the Windows-side
  # `vEthernet (WSL)` adapter it sits behind, and re-apply that smaller value
  # whenever it reconfigures the NIC — which happens long after boot, so an
  # `/etc/wsl.conf` `[boot] command` does not hold. This has bitten this host
  # twice (eth0 at 1280 against a host adapter at 1500).
  #
  # The failure is a PMTU black hole, and it is very easy to misdiagnose:
  # Tailscale negotiates a peer path sized for the host figure, so every
  # WireGuard packet above the Linux figure is dropped silently at eth0. Small
  # requests succeed, large responses vanish, `tailscale serve` HTTPS dies in
  # the handshake (`TLS handshake error … EOF`) — and `tailscale status`,
  # `tailscale serve status` and `tailscale ping` all stay healthy throughout,
  # because pings are small. So it is checked on every launch.
  #
  # Only ever raised to the host adapter's own MTU, never to a hard-coded
  # number: a link that legitimately needs a smaller one keeps it.
  HOST_MTU="$(powershell.exe -NoProfile -Command "(Get-NetIPInterface -AddressFamily IPv4 | Where-Object { \$_.InterfaceAlias -match 'WSL' } | Select-Object -First 1).NlMtu" 2>/dev/null | tr -d '\r\n')"
  WSL_MTU="$(ip -o link show eth0 2>/dev/null | sed -n 's/.* mtu \([0-9]*\).*/\1/p')"
  # Anything non-numeric (absent adapter, unexpected PowerShell output) stands
  # down rather than reaching `[ -gt ]` with a string.
  case "$HOST_MTU" in '' | *[!0-9]*) HOST_MTU="" ;; esac
  case "$WSL_MTU" in '' | *[!0-9]*) WSL_MTU="" ;; esac
  if [ -n "$HOST_MTU" ] && [ -n "$WSL_MTU" ] && [ "$HOST_MTU" -gt "$WSL_MTU" ]; then
    if ip link set dev eth0 mtu "$HOST_MTU" 2>/dev/null; then
      echo "Raised WSL eth0 MTU ${WSL_MTU} → ${HOST_MTU} (matching the Windows WSL adapter)."
    else
      echo "WSL eth0 MTU is ${WSL_MTU} but the Windows WSL adapter is ${HOST_MTU}, and raising"
      echo "  it failed (needs root in the distro). Tailscale HTTPS will stall on large"
      echo "  responses until it is raised: ip link set dev eth0 mtu ${HOST_MTU}"
    fi
  fi
  # ---------- end MTU self-heal --------------------------------------------

  WSL_IP="$(ip -4 -o addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  if [ -z "$WSL_IP" ]; then
    echo "Could not determine WSL eth0 IP — skipping portproxy check."
  else
    # Read current portproxy table once; per-port lookups are awk filters.
    PROXY_TABLE="$(powershell.exe -NoProfile -Command "netsh interface portproxy show all" 2>/dev/null | tr -d '\r')"

    # Build the list of ports we manage and the subset that needs fixing.
    PORTS_TO_FIX=""
    for p in $PANEL_PORT $PANEL_EXTRA_PORTS; do
      if printf '%s\n' "$PROXY_TABLE" | awk -v port="$p" -v wsl="$WSL_IP" '
          $2 == port && $3 == wsl && $4 == port { found=1 }
          END { exit found ? 0 : 1 }'; then
        echo "Windows portproxy already forwards :${p} → ${WSL_IP}:${p} ✓"
      else
        PORTS_TO_FIX="${PORTS_TO_FIX:+$PORTS_TO_FIX }$p"
      fi
    done

    if [ -n "$PORTS_TO_FIX" ]; then
      echo "Windows portproxy missing/stale for: ${PORTS_TO_FIX} — UAC prompt incoming."
      for p in $PORTS_TO_FIX; do
        echo "  (target: 0.0.0.0:${p} → ${WSL_IP}:${p})"
      done
      # Mirrors the snippet generated by panel/.../LanAccessPane.tsx:
      # delete both legacy specific-IP and current 0.0.0.0 forms (idempotent),
      # add the persistent 0.0.0.0 form, then dedupe + (re)create the firewall rule.
      WIN_LAN_IP="$(powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Tailscale' -and \$_.IPAddress -notmatch '^169\.|^127\.' } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r\n')"
      # Doubled single quotes inside firewall-rule names — PowerShell's escape
      # for a literal ' inside a single-quoted string. Required because the
      # whole PS_PAYLOAD is itself wrapped in single quotes by -ArgumentList.
      PS_PAYLOAD=""
      for p in $PORTS_TO_FIX; do
        PS_PAYLOAD="${PS_PAYLOAD}netsh interface portproxy delete v4tov4 listenport=${p} listenaddress=0.0.0.0 ; "
        if [ -n "$WIN_LAN_IP" ]; then
          PS_PAYLOAD="${PS_PAYLOAD}netsh interface portproxy delete v4tov4 listenport=${p} listenaddress=${WIN_LAN_IP} ; "
        fi
        PS_PAYLOAD="${PS_PAYLOAD}netsh interface portproxy add v4tov4 listenport=${p} listenaddress=0.0.0.0 connectport=${p} connectaddress=${WSL_IP} ; "
        PS_PAYLOAD="${PS_PAYLOAD}Get-NetFirewallRule -DisplayName ''Pavilio LAN ${p}'' -EA SilentlyContinue | Remove-NetFirewallRule ; "
        PS_PAYLOAD="${PS_PAYLOAD}New-NetFirewallRule -DisplayName ''Pavilio LAN ${p}'' -Direction Inbound -LocalPort ${p} -Protocol TCP -Action Allow | Out-Null ; "
      done
      PS_PAYLOAD="${PS_PAYLOAD}Write-Host DONE ; Start-Sleep 2"
      if powershell.exe -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command','${PS_PAYLOAD}'" >/dev/null 2>&1; then
        echo "Portproxy + firewall rules updated for: ${PORTS_TO_FIX}"
      else
        echo "  UAC canceled or failed — LAN access may not work for: ${PORTS_TO_FIX}"
        echo "  Re-run the shortcut and approve the prompt to fix."
      fi
    fi
  fi
fi
# ---------- end portproxy self-heal ----------------------------------------

echo "Enabling LAN access (panel rebinds 0.0.0.0)..."
# The panel closes its 127.0.0.1 listener mid-request to rebind on 0.0.0.0,
# so curl typically returns "Empty reply from server" / "Connection reset" —
# that's expected, not a failure. Fire the request, ignore the exit code,
# then poll for the new listener.
curl -sS --max-time 5 -X POST "${BASE}/api/mobile-access/lan/enable" >/dev/null 2>&1 || true

printf 'Waiting for panel rebind'
RECONNECTED=0
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 1 "${BASE}/api/auth/status"; then
    echo " ready."
    RECONNECTED=1
    break
  fi
  printf '.'
  sleep 0.5
done
if [ "$RECONNECTED" = 0 ]; then
  echo
  echo "  panel did not come back after rebind — exiting to bash."
  exec bash
fi

STATUS="$(curl -s "${BASE}/api/mobile-access/status")"
LAN_IP="$(printf '%s' "$STATUS" | grep -o '"lanIp":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
TOKEN="$(printf '%s' "$STATUS" | grep -o '#mt=[A-Za-z0-9_-]*' | head -n 1 | cut -d= -f2)"

echo
echo "===== Pavilio panel ready ====="
if [ -n "$TOKEN" ]; then
  echo "Local browser:   http://localhost:${PANEL_PORT}/#mt=${TOKEN}"
  if [ -n "$LAN_IP" ]; then
    echo "LAN devices:     http://${LAN_IP}:${PANEL_PORT}/#mt=${TOKEN}"
  fi
  echo "(Ctrl+click in Windows Terminal, or copy-paste into your browser.)"
else
  echo "(Could not extract pairing token — visit http://localhost:${PANEL_PORT} manually.)"
fi
if [ -n "${PANEL_EXTRA_PORTS}" ] && [ -n "${LAN_IP:-}" ]; then
  echo
  echo "Extra LAN-exposed ports (apps must bind to 0.0.0.0 inside WSL to be reachable):"
  for p in $PANEL_EXTRA_PORTS; do
    case "$p" in
      443) echo "  - https://${LAN_IP}/        (port 443 → WSL — Caddy/nginx etc.)" ;;
      80)  echo "  - http://${LAN_IP}/         (port 80  → WSL)" ;;
      *)   echo "  - http://${LAN_IP}:${p}/" ;;
    esac
  done
fi
echo
echo "Stop with: npm stop"
echo

# Optional foreground command to keep the terminal busy after the panel is up
# (e.g. a local reverse proxy like Caddy). Set PANEL_POST_LAUNCH_CMD via the
# untracked start-panel-windows.local.env. The terminal closes when this
# command exits, so use `exec <cmd>` inside it if you want clean teardown.
if [ -n "${PANEL_POST_LAUNCH_CMD:-}" ]; then
  echo "Running PANEL_POST_LAUNCH_CMD..."
  exec bash -lc "${PANEL_POST_LAUNCH_CMD}"
fi

exec bash
