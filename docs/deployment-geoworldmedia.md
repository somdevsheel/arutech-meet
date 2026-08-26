# Test deployment: geoworldmedia.com

This is the **concrete, filled-in instance** of `docs/deployment-lightsail.md`'s generic template, for one
specific test deployment. Read that doc for the full explanation of *why* each step exists (TLS, LiveKit's
`use_external_ip`, the S3-vs-MinIO tradeoff, etc.) — this file only records the actual decisions made for
*this* deployment and the exact values to use, so nothing has to be re-decided or re-derived each session.

## Decisions already made

| Item | Value |
|---|---|
| Domain | `geoworldmedia.com` — the **apex/root domain itself**, not a subdomain |
| Static IP | **Skipped** — using the instance's regular public IP instead. See caveat below. |
| Instance plan | 4 GB RAM / 2 vCPU (~$20/mo) — recording (Egress) not expected to be reliable at this size; bump to 8 GB (~$40/mo) first if recording needs testing |
| Storage (recordings) | Self-hosted MinIO (in the same Docker Compose stack) — see the recording-playback-from-outside caveat in `docs/deployment-lightsail.md` §6 if recording gets tested |
| LiveKit | Self-hosted (not LiveKit Cloud) — runs in the same Docker Compose stack as everything else |
| SSH access | This session's own key is the one authorized on the instance: |

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPF7F6+PgRnxpITfSjRvXojfTYsrWqPM4ZkeIPSgsqkW somdevsheel7@gmail.com
```

**Using the apex domain means this instance owns `geoworldmedia.com` entirely** — there's no separate
subdomain sitting alongside anything else already hosted at the root. The domain currently resolves to
`2.57.91.91` (its registrar's default parking-page IP, on `ns1/ns2.dns-parking.com`) — that existing A
record needs to be **edited/replaced**, not added alongside, or DNS will point at two different IPs and
nothing will resolve reliably. If anything else is meant to live at `geoworldmedia.com` (a marketing site,
email via MX records, etc.), flag that before step 4 below — pointing the apex here will otherwise silently
take it over.

**No static IP means: never stop/restart the instance during testing.** The public IP only changes on
stop/start (not on its own), so leaving it running the whole time behaves exactly like a static IP — but
stopping it to save cost between sessions changes the IP, which breaks the DNS record, invalidates the
TLS cert's reachability, and goes stale in LiveKit's advertised ICE candidates, all at once. If that
happens: update the DNS A record below to the new IP, wait for it to resolve, then re-run the TLS issuance
step (`docs/deployment-lightsail.md` §8) — nothing else needs to change, since every config here already
references `$DOMAIN`, never the IP directly.

## 1. Create the instance (AWS console — you do this part)

Lightsail console → **Create instance**:

- Platform: **Linux/Unix** → Blueprint: **OS Only → Ubuntu 22.04 LTS**
- Plan: **4 GB RAM / 2 vCPU** (or 8 GB if recording needs to work — see table above)
- SSH key pair: **New key** → paste the public key listed above
- Name: e.g. `arutech-meet-test` → **Create instance**

## 2. Firewall (same instance → Networking tab → IPv4 Firewall)

Open exactly these:

| Application | Protocol | Port(s) |
|---|---|---|
| SSH | TCP | 22 |
| HTTP | TCP | 80 |
| HTTPS | TCP | 443 |
| Custom | TCP | 7880 |
| Custom | TCP | 7881 |
| Custom | UDP | 50000-50100 |

## 3. Get the public IP

Instance details page shows it directly (no separate static-IP object needed, since we're skipping that).

## 4. DNS (in geoworldmedia.com's registrar dashboard)

**Edit the existing apex A record** (don't just add a new one — see the caveat above) so it points at the
new public IP instead of `2.57.91.91`:

| Field | Value |
|---|---|
| Type | A |
| Host | `@` (root/apex — exact label depends on the registrar's UI: some use `@`, some leave it blank) |
| Value | *(the public IP from step 3)* |
| TTL | 300 (or default) |

Confirm it's resolving to the *new* IP before moving on (registrar propagation for an apex record can take
longer than a subdomain's, since it's often cached more aggressively):

```bash
dig +short geoworldmedia.com
```

## 5. Hand off

Once steps 1–4 are done, give the public IP (and confirm DNS resolves to it, not the old parking IP). From
there, everything is driven over SSH directly — server setup, secrets generation, LiveKit/nginx config
rendering, TLS issuance via certbot, build, migrate, and the final real-device verification — following
`docs/deployment-lightsail.md` §4 through §11 exactly, with `DOMAIN=geoworldmedia.com` and the static-IP
step skipped as decided above.

## Status

- [x] Instance created — `indium`, 4 GB/2 vCPU, Ubuntu 22.04, Mumbai (ap-south-1), public IP `13.200.249.4`
- [x] Firewall rules added — 22, 80, 443, 7880, 7881 TCP + 50000-50100 UDP, all confirmed open from outside
- [x] Public IP obtained
- [x] Existing apex A record edited to the new IP, and resolving
- [x] Server setup (Docker install, repo clone)
- [x] Secrets generated (`.env.lightsail`) — storage backend: self-hosted MinIO
- [x] LiveKit/nginx/egress configs rendered
- [x] TLS certificate issued — real Let's Encrypt cert, confirmed via `curl -vI https://geoworldmedia.com`
- [x] Stack built and started — all 8 services (api, web, postgres, redis, livekit, egress, minio, nginx) up
- [x] Migration run — all Prisma migrations applied, `/health` confirms Postgres + Redis
- [ ] Verified from a real browser (camera/mic prompt, padlock, real meeting) — **next step, needs a human with a real browser/camera**

Fixed along the way (see git history on `main` for details):
- SSH key wasn't added to the instance at creation — added via the Lightsail browser SSH terminal.
- `next build` failed on `/login` and `/register` (`useSearchParams()` needs a Suspense boundary) — real bug,
  never caught before because this session had only ever run `next dev`. Fixed in commit `445d1f7`.
- Certbot's first real issuance landed in a `-0001`-suffixed lineage instead of the placeholder cert's path —
  fixed by hand-restructuring the `certbot-conf` volume so nginx picked up the real cert.
- **Port 7880 looked firewalled from outside but wasn't** — nginx never actually had a `listen 7880` server
  block (only 80/443 existed), even though the compose file and docs assumed one existed for TLS-terminated
  LiveKit signaling. The Lightsail firewall rule was correct the whole time. Fixed in commit `7b69fe9`.

## Teardown

When done testing: `dc down -v` (see `docs/deployment-lightsail.md` §Teardown), then delete the instance
from the Lightsail console. Since there's no separate static IP object here, there's nothing extra to
release. Restore the apex A record to whatever it should point at afterward (or back to the parking IP) if
`geoworldmedia.com` has a life beyond this test.
