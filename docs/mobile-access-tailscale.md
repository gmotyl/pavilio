# Mobile access via Tailscale

Reach the panel from your phone without exposing it to your LAN or the public internet. The panel binds only to `127.0.0.1`; `tailscale serve` on the host proxies HTTPS from your tailnet into loopback.

The host is whatever machine runs the panel — a Mac, a Linux box, or a WSL2 distro. Setup differs per host: [One-time Mac setup](#one-time-mac-setup) or [WSL setup](#wsl-setup).

## How it works

```
 Phone (Tailscale VPN)
        │
        ▼
 [Tailnet, private overlay network]
        │
        ▼
 Host (Mac / Linux / WSL distro):
 tailscale serve --https=443 → http://127.0.0.1:<panel-port>
        │
        ▼
 Panel (Express + Vite, loopback-only)
```

Two layers of authentication:

1. **Network layer** — Tailnet membership. Only devices signed into your Tailscale account can reach `https://<your-host>.<tailnet>.ts.net`.
2. **Application layer** — a 256-bit pairing token carried in a signed session cookie. The token rotates every time you click **Enable**. Clicking **Disable** invalidates every paired phone in one shot.

Both layers are required. Tailnet membership alone isn't enough — a stolen phone or a compromised tailnet device would otherwise inherit panel access (and the panel exposes a shell surface: terminal sessions, file read/write, git).

## Prerequisites

A Tailscale account in any tier. Free "Personal" works.

A host that can run `tailscale serve --https`: macOS, Linux, or a WSL2 distro. Windows itself cannot (see [Windows hosts](#windows-hosts)).

### Tailscale admin configuration (one-time, critical)

The panel fails to enable mobile access if these aren't set, with a `Post https://unused/machine/feature/query` 500 error from the CLI. Do this first:

1. Open [https://login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns)
2. Enable **MagicDNS** — gives devices human-readable `<hostname>.<tailnet>.ts.net` names
3. Enable **HTTPS Certificates** — lets Tailscale issue real Let's Encrypt certs for those names, so `tailscale serve --https=443` has something to serve

Both toggles are on the same admin page.

## One-time Mac setup

For a macOS host. If the panel runs inside a WSL distro, do [WSL setup](#wsl-setup) instead.

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

## WSL setup

For a host where the panel runs inside a WSL2 distro (this is the section the panel's setup panes link to).

The panel runs *inside* the distro, so the Tailscale node it drives lives inside the distro too — **not** the Tailscale you may already have installed on Windows. The panel never reaches across the WSL boundary; `which tailscale` and `http://127.0.0.1:<panel-port>` both have to mean the distro. That decision is recorded in ADR 0009 (`tailscale-node-lives-inside-the-wsl-distro`), and three of its consequences matter before you start:

- **The machine appears twice on your tailnet** — the Windows node and the distro's node, side by side, with two different MagicDNS names.
- **The phone pairs with the distro's name**, e.g. `https://spock-wsl.<tailnet>.ts.net`, not the Windows one. If you had a bookmark for the Windows node, it changes once.
- **The distro's node is only up while the WSL VM is up.** It leaves the tailnet on `wsl --shutdown` or when the VM idles out. The Windows node does not — but neither does the panel, so this costs nothing extra.

### 1. Install Tailscale inside the distro

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Run this in the distro's shell, not in PowerShell. Do not use `tailscale.exe` from `/mnt/c/...` — that is the Windows node, in a different network namespace.

**Check that it actually installed** — the script can add the repo and then quietly stop:

```bash
tailscale version
```

The script runs `apt-get update` before installing, and `apt-get update` exits non-zero if *any* configured repository fails — a stale PPA with no Release file for your Ubuntu release is enough. The tailscale repo itself is fine and its package lists are already fetched at that point, so finish the job by hand:

```bash
sudo apt-get install -y tailscale
```

Then clean the broken entries out of `/etc/apt/sources.list.d/` at your leisure, or the next apt-repo installer fails the same way.

### 2. Start `tailscaled` — there is no systemd here

The Debian/Ubuntu package ships exactly one supervision file, `/lib/systemd/system/tailscaled.service`, and it is inert on a distro whose PID 1 is `init(Ubuntu)` (`systemctl is-system-running` reports `offline`). The package ships **no** SysV init script, so `service tailscaled start` has nothing to run either. You start the daemon yourself:

```bash
sudo sh -c 'nohup /usr/sbin/tailscaled \
  --tun=userspace-networking \
  --state=/var/lib/tailscale/tailscaled.state \
  --socket=/run/tailscale/tailscaled.sock \
  >/var/log/tailscaled.log 2>&1 &'
```

Then confirm the CLI can reach it — before sign-in the expected answer is `Logged out.`:

```bash
tailscale status
```

Why each part:

- **`nohup … &` and the redirect.** `tailscaled` runs in the foreground and logs to stdout. With no service manager, nothing backgrounds it, keeps it alive past your shell, or captures its log. `sudo sh -c '…'` matters too: the redirect has to be opened by root, not by your own shell.
- **`--state` / `--socket`.** These are also `tailscaled`'s Linux defaults (`/var/run/tailscale/tailscaled.sock` is `/run/tailscale/tailscaled.sock` through the usual symlink, which is where the `tailscale` CLI looks), but the packaged unit passes them explicitly and lets systemd's `StateDirectory=` / `RuntimeDirectory=` create the directories. Pass them explicitly for the same reason the unit does: so the daemon and the CLI cannot disagree about where state and socket live.
- **`--tun=userspace-networking`.** Recommended here even though `/dev/net/tun` exists in WSL2 and real TUN mode would work. Mobile access only needs *inbound* `tailscale serve` into loopback, which userspace networking serves fully — and it avoids having the daemon install netfilter rules and rewrite `/etc/resolv.conf` inside a distro whose routing and DNS are WSL's to manage (WSL regenerates `resolv.conf` on boot). The trade-off: in this mode the distro itself cannot reach other tailnet nodes over ordinary sockets. If you want that, drop the flag to get real TUN mode, and expect the daemon to touch iptables and DNS.
- **No `--port`.** The default (`0`) auto-selects the WireGuard port. The packaged unit pins `41641` from `/etc/default/tailscaled`; behind WSL2's NAT there is nothing to gain by pinning it.

### 3. Sign in

```bash
sudo tailscale up --hostname=spock-wsl
```

`sudo` is required — this is a privileged daemon operation, and the panel's own CLI calls also run as root.

The command **prints an authentication URL and waits.** There is no browser in the distro, so open that URL on the Windows side: copy-paste it into your Windows browser, or click it if your terminal linkifies it. Sign in with the same Tailscale account as the rest of your tailnet, and the command returns once the node is authorized.

`--hostname` is optional but worth it: it keeps the distro's node visibly distinct from the Windows node, which otherwise arrives with a confusingly similar name. Whatever it resolves to is the MagicDNS name your phone will pair with — you can read it back with `tailscale status --json` or from `login.tailscale.com/admin/machines`.

### 4. Enable HTTPS certificates for the tailnet

The same one-time tailnet requirement as the Mac path, and it is not optional: without it `tailscale serve --https=443` has no certificate to serve and the panel fails to enable mobile access. Enable **MagicDNS** and **HTTPS Certificates** at [https://login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns) — see [Tailscale admin configuration](#tailscale-admin-configuration-one-time-critical). If you already did this for a Mac or another host, it is a tailnet-wide setting and is already done.

### 5. Check the distro's `eth0` MTU

Do this before you conclude anything is wrong with certificates or DNS — a too-small `eth0` breaks `tailscale serve` in a way that looks like everything *except* an MTU problem.

```bash
ip -o link show eth0 | awk '{print $5}'
```

If that prints anything below ~1400, raise it:

```bash
sudo ip link set dev eth0 mtu 1500
```

Why it matters: Tailscale negotiates a path MTU with each peer (commonly `1360`, visible as `mtu=` in `grep 'now using' /var/log/tailscaled.log`). If `eth0` cannot carry that, every WireGuard packet above its limit is dropped **silently** — no error, no ICMP that anything acts on. Small packets sail through, so the node looks perfectly healthy:

- `tailscale status` shows the node online, `tailscale ping` to a nearby peer answers in single-digit ms
- MagicDNS resolves, the hostname pings fine
- but **`tailscale serve` HTTPS never loads from any client**, because the multi-KB ServerHello and Let's Encrypt chain exceed the limit. The daemon logs `http: TLS handshake error from <peer>: EOF` while the browser reports a plain timeout.

Confirm it with a do-not-fragment ping from another machine on the tailnet — find the size where it flips:

```powershell
ping -f -l 1000 <tailnet-ip>    # succeeds
ping -f -l 1200 <tailnet-ip>    # "Packet needs to be fragmented" or silence
```

Seen in the wild on a distro whose `eth0` came up at `1280` while the Windows `vEthernet (WSL)` side was `1500`. That is not a WSL default and the cause was never identified, so treat it as something to *check*, not something that cannot happen to you. Lowering the MTU on a *client* works around it for that one client — useless for a phone, whose MTU you cannot set — so fix `eth0`, which fixes every client at once.

The setting does not survive a VM restart. Pin it in the boot hook below, ahead of everything else.

### 6. Keep `tailscaled` running across `wsl --shutdown`

The daemon you started in step 2 dies with the VM. Nothing in the distro brings it back, so chain it onto WSL's boot hook.

`/etc/wsl.conf` gives you **one** `[boot] command` slot, and something is probably in it already. Do not replace what is there — chain onto it. A distro that starts `sshd` today becomes:

```ini
[boot]
command = /bin/sh -c "ip link set dev eth0 mtu 1500; /etc/init.d/ssh start; /usr/sbin/tailscaled --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock >>/var/log/tailscaled.log 2>&1 &"
```

Notes on that line:

- It must stay a **single** line. `[boot] command` takes one command; `/bin/sh -c "…; …"` is how you get two.
- The MTU line comes first and is only needed if [step 5](#5-check-the-distros-eth0-mtu) found a small `eth0`; drop it otherwise.
- Keep the existing command first, verbatim. `/etc/init.d/ssh start` is an example — copy whatever your own file has rather than this one.
- The trailing `&` is required. The boot command runs synchronously as root during startup; an un-backgrounded `tailscaled` would sit there and hold the distro's boot open.
- `>>` appends, so restarts accumulate in one log instead of truncating the previous boot's evidence.

Then, from Windows:

```powershell
wsl --shutdown
```

Reopen the distro and check that the hook worked:

```bash
tailscale status     # should show your node, not "failed to connect to local tailscaled"
```

If it says `failed to connect to local tailscaled`, the hook did not run the daemon — read `/var/log/tailscaled.log`, and check `/etc/wsl.conf` for a stray line break or a mismatched quote.

### What the panel does and does not do

Keeping `tailscaled` alive is **host configuration, and the panel does not manage it.** The panel does not start the daemon, does not supervise or restart it, does not write `/etc/wsl.conf`, and does not repair a boot hook you got wrong. All it does is notice that the daemon is down, say so, and link back to this section. A panel that silently started a VPN daemon as root would be a surprise we are not willing to ship (ADR 0009).

Sign-in is the same: one interactive `sudo tailscale up` per distro, done by you, once.

## Phone setup

Install Tailscale:

- iOS: [App Store](https://apps.apple.com/app/tailscale/id1470499037)
- Android: [Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn)

Sign in with the **same Tailscale account** as the host. Allow the VPN profile when iOS/Android prompts. Leave the toggle in the Tailscale app set to "on".

## Pairing from the panel

1. In the panel, click the **Mobile access** toggle in the left sidebar (bottom), or open the Dashboard and click the **Mobile access** button in the header.
2. The modal opens. Flip the toggle switch to on.
3. The panel runs `tailscale serve --bg --https=443 http://127.0.0.1:<panel-port>` and generates a fresh 256-bit pairing token.
4. A QR code appears containing `https://<your-host>.<tailnet>.ts.net/#mt=<token>`.
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

### Can reach the host URL but the panel never loads

Check that `tailscale serve` is actually forwarding:

```bash
tailscale serve status
# Should show:  https://<your-host>.<tailnet>.ts.net  →  http://127.0.0.1:<panel-port>
```

If not, the panel didn't successfully register serve. Disable and re-enable from the modal.

If `serve` *is* configured and the daemon logs `http: TLS handshake error from <peer>: EOF` while the client just times out, the proxy is fine and the packets are being dropped for size — see [the `eth0` MTU](#5-check-the-distros-eth0-mtu).

### `DNS_PROBE_FINISHED_NXDOMAIN` on a Windows client

The Windows machine is on the tailnet but has **"Use Tailscale DNS settings" off**, so it resolves through your router, which knows nothing about `*.ts.net`. Check and fix:

```powershell
tailscale debug prefs        # look for "CorpDNS": false
tailscale set --accept-dns=true
ipconfig /flushdns
```

This routes Windows DNS through Tailscale's `100.100.100.100`, which forwards non-tailnet domains to your existing servers. Hosts-file entries are unaffected — Windows consults them before any resolver — so local development names pinned there keep working.

### Do not diagnose tailnet DNS with `nslookup`

`nslookup` talks to a DNS server directly and **ignores Windows' NRPT rules**, which are exactly the mechanism Tailscale uses to route `*.ts.net` to its own resolver. So it reports `Non-existent domain` for a name the rest of the system resolves perfectly, and sends you chasing a DNS fault that is not there.

Use something that goes through the Windows resolver:

```powershell
ping <host>.<tailnet>.ts.net           # resolves via the DNS Client service
Resolve-DnsName <host>.<tailnet>.ts.net
Get-DnsClientNrptPolicy | Select-Object -ExpandProperty Namespace   # should list .ts.net
```

If `ping` resolves the name but the page still will not load, the DNS layer is fine — look at [the `eth0` MTU](#5-check-the-distros-eth0-mtu).

### HTTPS cert takes ~30s on first enable

Normal. Tailscale provisions a Let's Encrypt cert on first use for the hostname. Subsequent enables are instant (cert is cached).

### Phone browser warns "certificate is untrusted" or "not private"

Happens on the very first access, usually because:

- **Let's Encrypt provisioning is still in flight.** Wait 30–60s after clicking Enable, then hit Reload on the phone.
- **Phone clock is wrong.** Cert validation fails if the device clock is off by minutes. Check iOS/Android auto-date setting.
- **Phone has no DNS.** The Tailscale VPN must be on with DNS delegation working; OCSP/CRL checks can fail otherwise.

If the cert still reads "untrusted" after a full minute, the cert is probably Tailscale's internal fallback (issued before Let's Encrypt finished). Toggle Disable → Enable in the modal to force a re-issue.

### `Blocked request. This host is not allowed.`

Vite's anti-DNS-rebind allowlist rejected the request — which means you are on the dev entry, `panel/server/dev.ts` (`pnpm dev`). Running the panel the normal way (`pnpm start`, serving the built bundle) starts `panel/server/index.ts`, where there is no Vite and no host allowlist at all, so this failure cannot happen in that mode. If you hit it, you are on `pnpm dev`.

`panel/server/dev.ts` sets `server.allowedHosts: true`, turning the allowlist off entirely: any `Host` — `.ts.net`, a custom tailnet domain, a LAN IP — reaches the mobile-auth middleware, which is where non-loopback requests are actually gated. So if you still see this:

1. You're on an older checkout — pull the latest.
2. Restart `pnpm dev` after any change to `allowedHosts` — Vite reads it at startup only.

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
| `tailscale serve` config | Stored by the Tailscale daemon (`/Library/Tailscale/serve.json` on macOS; inside `/var/lib/tailscale/tailscaled.state` on Linux and WSL). Managed via `tailscale serve` commands. |
| `/etc/wsl.conf` | WSL only, and yours to maintain: the `[boot] command` slot that starts `tailscaled` after a `wsl --shutdown`. The panel never reads or writes this. |
| Panel code | `panel/server/lib/tailscale.ts` (CLI wrapper), `panel/server/lib/mobile-auth.ts` (token / cookie), `panel/server/routes/mobile-access.ts` (HTTP API). |

## Threat model (brief)

**In scope:** protect against a stolen/compromised phone, protect against a malicious device on the same tailnet, prevent the panel from ever being reachable on your LAN or the public internet.

**Out of scope:** protect against a compromised Mac. If someone has shell access to the Mac running the panel, they have the pairing token and the signing key and can impersonate any paired phone.

**Attack surface:** anyone on the tailnet can reach the HTTPS endpoint. Without a valid `mobile_session` cookie (i.e., without having scanned a recent QR), every request — HTTP and WebSocket — is rejected with 401 / WS close code 4003 before any handler attaches. Loopback origin is exempt (that's the Mac itself).

**Rotation:** every **Enable** click generates a fresh 256-bit token and bumps a generation counter. Cookies are HMAC-signed with a per-install secret and bound to the generation; a cookie from a previous generation fails verification even if it hadn't expired.

## Windows hosts

Tailscale Serve HTTPS is a macOS / Linux feature (Windows Tailscale does not support `serve --https` as of early 2026). Two options if your machine is a Windows box:

- **Run the panel inside a WSL2 distro** and give that distro its own tailnet node — [WSL setup](#wsl-setup). This is the supported path.
- Run the panel natively on Windows and reach it through a Tailscale Funnel or a reverse proxy — not covered here.
