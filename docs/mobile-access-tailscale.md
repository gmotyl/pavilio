# Mobile access via Tailscale

Reach the panel from your phone without exposing it to your LAN or the public internet. The panel binds only to `127.0.0.1`; `tailscale serve` on your Mac proxies HTTPS from your tailnet into loopback.

## How it works

```
 Phone (Tailscale VPN)
        │
        ▼
 [Tailnet, private overlay network]
        │
        ▼
 Mac: tailscale serve --https=443 → http://127.0.0.1:<panel-port>
        │
        ▼
 Panel (Express + Vite, loopback-only)
```

Two layers of authentication:

1. **Network layer** — Tailnet membership. Only devices signed into your Tailscale account can reach `https://<your-mac>.<tailnet>.ts.net`.
2. **Application layer** — a 256-bit pairing token carried in a signed session cookie. The token rotates every time you click **Enable**. Clicking **Disable** invalidates every paired phone in one shot.

Both layers are required. Tailnet membership alone isn't enough — a stolen phone or a compromised tailnet device would otherwise inherit panel access (and the panel exposes a shell surface: terminal sessions, file read/write, git).

## Prerequisites

A Tailscale account in any tier. Free "Personal" works.

### Tailscale admin configuration (one-time, critical)

The panel fails to enable mobile access if these aren't set, with a `Post https://unused/machine/feature/query` 500 error from the CLI. Do this first:

1. Open [https://login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)
2. Enable **MagicDNS** — gives devices human-readable `<hostname>.<tailnet>.ts.net` names
3. Enable **HTTPS Certificates** — lets Tailscale issue real Let's Encrypt certs for those names, so `tailscale serve --https=443` has something to serve

Both toggles are on the same admin page.

## One-time Mac setup

```bash
brew install --cask tailscale
open -a Tailscale     # menubar icon, sign in with your account
```

First-launch requires approving a system extension and a VPN profile. Grant both.

Confirm the CLI is reachable:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
```

Should print your devices. If it prints "Logged out", click the menubar icon and sign in.

## Phone setup

Install Tailscale:

- iOS: [App Store](https://apps.apple.com/app/tailscale/id1470499037)
- Android: [Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn)

Sign in with the **same Tailscale account** as your Mac. Allow the VPN profile when iOS/Android prompts. Leave the toggle in the Tailscale app set to "on".

## Pairing from the panel

1. In the panel, click the **Mobile access** toggle in the left sidebar (bottom), or open the Dashboard and click the **Mobile access** button in the header.
2. The modal opens. Flip the toggle switch to on.
3. The panel runs `tailscale serve --bg --https=443 http://127.0.0.1:<panel-port>` and generates a fresh 256-bit pairing token.
4. A QR code appears containing `https://<your-mac>.<tailnet>.ts.net/#mt=<token>`.
5. Scan the QR with your phone's camera. It opens in Safari/Chrome, authenticates via the token fragment, and sets a signed `mobile_session` cookie scoped to the tailnet host. The panel loads. Paired.

The full URL is shown under the QR if you prefer to copy-paste instead of scan.

## Unpairing / rotating

- **Disable** — Click the toggle off in the modal. This runs `tailscale serve reset` **and** rotates the pairing-token generation, which invalidates all existing phone sessions at once. Re-enabling requires a fresh QR scan on every previously-paired phone.
- **Rotate pairing token** (button inside the modal when on) — generates a new token and a new QR without touching `tailscale serve`. Previously-paired phones get a "Scan a fresh QR" screen on their next request.

## Troubleshooting

### `error enabling https feature: … feature/query`

Two very different root causes share this error text. Work through them in order:

**A. Another VPN is installed and active.** OpenVPN, Cisco AnyConnect, NordVPN, and similar tunnels can hijack the default route (including the IPv6 path Tailscale uses to reach its control plane), which surfaces as:

```
all connection attempts failed (HTTPS: dial tcp [2606:b740:…]:443: connect: no route to host)
```

Disable the other VPN client (or quit it entirely) and retry. If you don't know whether you have one running, check menubar icons and `System Settings → Network → VPN & Filters`.

The same conflict also produces a subtler failure after pairing succeeds: the Mac peer drops to **offline** in the Tailscale admin panel once you walk away and the connection goes idle, so the phone can no longer reach it even though the Mac is awake. If `login.tailscale.com/admin/machines` shows your Mac as offline while you're AFK, quit the other VPN client and it should come back within seconds.

**B. Admin setup not complete.** Enable **HTTPS Certificates** + **MagicDNS** at [https://login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns). Both toggles must be green. Then restart Tailscale on the Mac (menubar → Quit, relaunch) so the daemon picks up the new tailnet config.

**Diagnostic commands** if still stuck:

```bash
tailscale netcheck             # confirms daemon can reach Tailscale relays
tailscale cert $(hostname)     # direct cert-issuance test (same path as serve)
```

If `tailscale cert` succeeds but `tailscale serve` fails, open an issue — that's unusual and worth investigating.

### `invalid argument format` from `tailscale serve`

Your Tailscale CLI is older than v1.60 and uses a different argument shape. Update:

```bash
brew upgrade tailscale   # for CLI-only installs
# or for the cask:
brew upgrade --cask tailscale
```

### `tailscale binary not found`

The panel looks for the CLI at these paths (first match wins):

- `/Applications/Tailscale.app/Contents/MacOS/Tailscale`
- Whatever `tailscale` resolves to on `PATH` (homebrew, Linux installs)

If you installed via a non-standard location, either symlink into one of the above or add the directory to the `PATH` of the shell that launched the panel.

### `Serve already configured for a different target`

Another process or a previous run already registered something with `tailscale serve`. The panel refuses to overwrite it. Inspect and decide:

```bash
tailscale serve status
# If it's yours to reset:
tailscale serve reset
```

Then click Enable again.

### Phone shows "Scan a fresh QR"

The pairing token on the server has rotated since your phone last connected (you clicked Enable, Disable, or Rotate on the Mac). Open the modal on the Mac, click Enable, rescan on the phone.

### Can reach the Mac URL but the panel never loads

Check that `tailscale serve` is actually forwarding:

```bash
tailscale serve status
# Should show:  https://<your-mac>.<tailnet>.ts.net  →  http://127.0.0.1:<panel-port>
```

If not, the panel didn't successfully register serve. Disable and re-enable from the modal.

### HTTPS cert takes ~30s on first enable

Normal. Tailscale provisions a Let's Encrypt cert on first use for the hostname. Subsequent enables are instant (cert is cached).

### Phone browser warns "certificate is untrusted" or "not private"

Happens on the very first access, usually because:

- **Let's Encrypt provisioning is still in flight.** Wait 30–60s after clicking Enable, then hit Reload on the phone.
- **Phone clock is wrong.** Cert validation fails if the device clock is off by minutes. Check iOS/Android auto-date setting.
- **Phone has no DNS.** The Tailscale VPN must be on with DNS delegation working; OCSP/CRL checks can fail otherwise.

If the cert still reads "untrusted" after a full minute, the cert is probably Tailscale's internal fallback (issued before Let's Encrypt finished). Toggle Disable → Enable in the modal to force a re-issue.

### `Blocked request. This host is not allowed.`

The Vite dev-server's anti-DNS-rebind allowlist rejected the request. The panel's config now allows `.ts.net` by default (see `panel/server/index.ts`, Vite `server.allowedHosts`). If you still hit this:

1. You're on an older checkout — pull the latest.
2. Your tailnet uses a custom domain (not `.ts.net`). Add it to `allowedHosts` in `panel/server/index.ts`.
3. Restart `pnpm dev` after any change to `allowedHosts` — Vite reads it at startup only.

## Manual teardown

If you want the tailnet-side proxy gone but don't care about invalidating phone sessions:

```bash
tailscale serve reset
```

This only removes the HTTPS proxy. Phone sessions paired to the current generation still have valid cookies. To invalidate sessions, click **Disable** in the modal (or delete `~/.panel/mobile-auth.json` and restart the panel).

## Files and state

| Path | What |
|---|---|
| `~/.panel/mobile-auth.json` | Persistent state: signing secret, current pairing token, generation counter. Delete to fully reset mobile auth. |
| `tailscale serve` config | Stored by the Tailscale daemon (`/Library/Tailscale/serve.json` on macOS). Managed via `tailscale serve` commands. |
| Panel code | `panel/server/lib/tailscale.ts` (CLI wrapper), `panel/server/lib/mobile-auth.ts` (token / cookie), `panel/server/routes/mobile-access.ts` (HTTP API). |

## Threat model (brief)

**In scope:** protect against a stolen/compromised phone, protect against a malicious device on the same tailnet, prevent the panel from ever being reachable on your LAN or the public internet.

**Out of scope:** protect against a compromised Mac. If someone has shell access to the Mac running the panel, they have the pairing token and the signing key and can impersonate any paired phone.

**Attack surface:** anyone on the tailnet can reach the HTTPS endpoint. Without a valid `mobile_session` cookie (i.e., without having scanned a recent QR), every request — HTTP and WebSocket — is rejected with 401 / WS close code 4003 before any handler attaches. Loopback origin is exempt (that's the Mac itself).

**Rotation:** every **Enable** click generates a fresh 256-bit token and bumps a generation counter. Cookies are HMAC-signed with a per-install secret and bound to the generation; a cookie from a previous generation fails verification even if it hadn't expired.

## Desktop-only note

Tailscale Serve HTTPS is a macOS / Linux feature (Windows Tailscale does not support `serve --https` as of early 2026). If you run the panel on Windows and want mobile access, use a Tailscale Funnel or reverse proxy alternative — not covered here.
