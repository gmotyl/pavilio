# Mobile access (short version)

The panel binds to `127.0.0.1` only — it's not reachable from your LAN or the public internet. To use it from your phone, you layer Tailscale on top: your Mac and phone join the same tailnet, and `tailscale serve` proxies HTTPS from the tailnet into loopback.

## One-time setup (Mac)

```bash
brew install --cask tailscale
open -a Tailscale     # sign in
```

Also, in the Tailscale admin console:

- Enable **HTTPS Certificates** at <https://login.tailscale.com/admin/dns>
- Enable **MagicDNS** (same screen)

## Pairing

1. Click the **Mobile access** button in the Dashboard header on your Mac.
2. Click **Enable mobile access** — a QR appears.
3. On the phone, install Tailscale (App Store / Play Store), sign in with the same account, allow the VPN profile.
4. Scan the QR with your phone camera. The panel opens. You're paired.

## Why the QR?

Tailnet membership alone isn't a strong enough gate — a stolen phone or a compromised tailnet device would otherwise get in, and the panel exposes a shell surface (terminal sessions, file read/write, git). The QR carries a 256-bit pairing token that rotates on every Enable. Clicking **Disable** instantly invalidates all paired phones.

## When things go wrong

- **"HTTPS cert error on enable"** → the HTTPS Certificates toggle isn't on yet in your tailnet admin.
- **"`tailscale` binary not found"** → Tailscale.app not installed, or not in a standard location.
- **"Serve already configured for a different target"** → the panel won't overwrite your existing `tailscale serve` config. Check with `tailscale serve status`; only reset if it's yours to reset.
- **Phone shows "Scan a fresh QR"** → the token rotated (someone hit Enable or Disable on the Mac after pairing). Re-enable and rescan.

Full write-up lives in the root `README.md` under "Mobile access (Tailscale)".
