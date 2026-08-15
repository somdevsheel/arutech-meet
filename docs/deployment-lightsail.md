# Deploying to AWS Lightsail (for real-device testing)

This is a **different, simpler target** than `docs/deployment.md`'s Kubernetes/Terraform/EKS reference
architecture. That one is built for horizontal scaling and managed HA services (RDS, ElastiCache); this
one is a **single Lightsail instance running everything in Docker Compose**, sized to answer one specific
question: *does this actually work from a real phone/laptop over the real internet*, not localhost. Use
this when you want to hand someone a URL and have them join a meeting from their own device; use the
Kubernetes path when you're actually taking this to production traffic.

Nothing here needs a Kubernetes cluster, a managed database, or a container registry — just one VM, a
domain you control, and about 20 minutes.

## Why a real device needs more than `docker compose up`

Camera/microphone access (`getUserMedia`) is refused by every browser and by React Native's WebRTC stack
on any origin that isn't `localhost` and isn't served over HTTPS. LiveKit's ICE candidates also have to
carry a real, publicly-routable IP address, not a private/container one, or a real device's SFU connection
just times out with no video. Both of these are invisible on `localhost` (where neither problem exists)
and only show up the moment you try this from an actual phone — which is exactly why this file exists
separately from the local dev setup in the root `README.md`.

Concretely, that means this deployment needs, and the local one doesn't:

- A domain name (or subdomain) with an A record you control
- A real TLS certificate (Let's Encrypt, free)
- LiveKit configured with `use_external_ip: true` instead of the local dev default of `false`
- Real generated secrets everywhere the local `.env.development` uses `change-me-...`/`devkey` placeholders

## What you get, honestly

This stands up the full meeting/classroom/calling loop, Team Chat, Contacts, Notes, notifications,
search, and the admin dashboard — every feature described in the root `README.md` and `docs/roadmap.md` —
on one instance. What it deliberately does **not** give you:

- **High availability.** One instance, one Postgres, one Redis. It goes down, everything goes down. That's
  the Kubernetes/RDS/ElastiCache path in `docs/deployment.md`, not this one.
- **Automatic TLS renewal out of the box** — set up the cron job in §Renewal below, or your cert expires in
  90 days and the site goes dark.
- **Recording playback from a real device, if you use the free self-hosted MinIO option instead of real S3**
  — see §Storage for exactly why, and which one to pick.
- **Anything AI-assistant-related** — Stage 8 is deliberately deferred (see `docs/roadmap.md`), this
  doesn't change that.

## Cost and instance sizing

Every backing service (Postgres, Redis, LiveKit, the Egress recording worker, the API, the web app, nginx)
runs on one box. LiveKit's Egress worker in particular runs headless Chrome + FFmpeg per concurrent
recording — the heaviest thing on this list by far.

| Lightsail plan | RAM / vCPU | Approx. cost | Good for |
|---|---|---|---|
| $20/mo | 4 GB / 2 vCPU | ~$0.03/hr | Core loop: auth, meetings, classes, chat, calling — no recording |
| $40/mo | 8 GB / 2 vCPU | ~$0.06/hr | Everything above **and** recording (Egress) working reliably |

Don't go below the $20/mo tier — Postgres + Redis + LiveKit + Next.js + Nest alone leave a 2 GB instance
with barely enough headroom to hold a single video call before swapping. Delete the instance when you're
done testing (§Teardown) — Lightsail bills hourly, this isn't meant to run 24/7 unattended.

## Prerequisites

- An AWS account with billing enabled
- A domain (or subdomain, e.g. `meet-test.yourdomain.com`) you can add a DNS A record to
- An SSH key pair (Lightsail can generate one for you on instance creation, or bring your own)
- This repo, and the ability to `git clone` it onto the instance (or `scp` it up)

## 1. Create the instance

1. Lightsail console → **Create instance**.
2. Platform: **Linux/Unix** → Blueprint: **OS Only → Ubuntu 22.04 LTS**.
3. Instance plan: at least **4 GB RAM / 2 vCPU** (see the sizing table above).
4. Name it (e.g. `arutech-meet-test`), create.
5. Once running, go to the instance's **Networking** tab → **Create static IP**, attach it to this
   instance. Without this, the instance's public IP changes on every stop/start, which breaks both your
   DNS record and LiveKit's advertised ICE candidates the next time it restarts.

## 2. DNS

Point an A record at the static IP:

```
meet-test.yourdomain.com.   A   <static IP>
```

Wait for it to resolve (`dig +short meet-test.yourdomain.com`) before continuing — certbot in step 6 needs
this to already work.

## 3. Firewall (Networking tab → IPv4 Firewall)

Open exactly these — anything else stays closed:

| Application | Protocol | Port(s) | Why |
|---|---|---|---|
| SSH | TCP | 22 | Restrict the source to your own IP if you can — Lightsail's firewall UI supports a CIDR per rule |
| HTTP | TCP | 80 | Redirects to HTTPS; also serves the Let's Encrypt ACME challenge |
| HTTPS | TCP | 443 | The app itself |
| Custom | TCP | 7880 | LiveKit signaling (TLS-terminated by nginx — see §Networking below) |
| Custom | TCP | 7881 | LiveKit's TCP fallback, for networks that block/throttle UDP |
| Custom | UDP | 50000-50100 | WebRTC media (audio/video/screen-share) — this is the one people forget, and its absence looks exactly like "camera works, but the other person is a black screen" |

## 4. Server setup

SSH in, then:

```bash
# Docker + Compose plugin
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
# log out and back in for the group change to apply, then:

git clone <your fork's URL> arutech-meet
cd arutech-meet
```

Every command from here on assumes you're in this directory. They also all get long
(`docker compose -f infrastructure/docker/docker-compose.lightsail.yml --env-file .env.lightsail -p arutech-meet`)
— set an alias once so the rest of this doc (and your own shell history) stays readable:

```bash
alias dc='docker compose -f infrastructure/docker/docker-compose.lightsail.yml --env-file .env.lightsail -p arutech-meet'
```

The explicit `-p arutech-meet` matters, not just for tidiness: without it, Compose infers the project name
from the directory *containing the compose file* (`infrastructure/docker`, giving volumes an unhelpful
`docker_...` prefix) rather than the repo itself, and that inference depends on which directory you happen
to run the command from. Pinning it means every command below — and the volume name used in step 6's
bootstrap — refers to the same thing regardless of your current directory. (`alias` doesn't survive a new
shell session; add it to `~/.bashrc` if you'll be coming back to this instance later.)

## 5. Secrets

Never reuse the local dev `.env.development` file for this — it's full of `change-me-...`/`devkey`
placeholders that are fine on localhost and a real vulnerability on a box with a public IP.

```bash
cat > .env.lightsail <<EOF
NODE_ENV=production
DOMAIN=meet-test.yourdomain.com

POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)

JWT_SECRET=$(openssl rand -hex 32)
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_EXPIRES_IN=30d
COOKIE_SECRET=$(openssl rand -hex 32)

API_PORT=4000
API_URL=https://meet-test.yourdomain.com
WEB_URL=https://meet-test.yourdomain.com
CORS_ORIGINS=https://meet-test.yourdomain.com

LIVEKIT_API_KEY=$(openssl rand -hex 16)
LIVEKIT_API_SECRET=$(openssl rand -hex 32)

SMTP_HOST=
SMTP_PORT=587
SMTP_FROM="Arutech Meet <no-reply@yourdomain.com>"
SMTP_SECURE=true

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
LOG_LEVEL=info
EOF
```

Replace `DOMAIN` and the `*_URL`/`CORS_ORIGINS` values with your actual domain (they have to match what
you set up in step 2). Leave `SMTP_*` blank if you don't have one yet — the app runs fine without email,
it just means password-reset/invite emails (where wired) silently no-op rather than send.

Then add storage credentials — see the next section for which path to pick before filling these in:

```bash
cat >> .env.lightsail <<EOF
S3_ENDPOINT=...
S3_PUBLIC_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=...
S3_PUBLIC_URL=...
EOF
```

`--env-file` only substitutes `${VAR}` references inside the compose file itself (used for
`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `DOMAIN`, and the `S3_*`/build-arg values) — the API container
additionally gets the **whole file** injected as its environment via `env_file:`, so anything you add here
reaches the app without a compose file change.

## 6. Storage: real S3 (recommended) vs. self-hosted MinIO

**Recommended: real AWS S3.** It already has valid, publicly-trusted TLS — zero extra certificate work,
and recording playback (a presigned download URL, opened directly in the browser) just works from any
device. Since this is already an AWS account:

```bash
aws s3api create-bucket --bucket arutech-meet-test-recordings --region us-east-1
aws iam create-user --user-name arutech-meet-test
aws iam put-user-policy --user-name arutech-meet-test --policy-name s3-recordings --policy-document '{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket"],
    "Resource": ["arn:aws:s3:::arutech-meet-test-recordings", "arn:aws:s3:::arutech-meet-test-recordings/*"] }]
}'
aws iam create-access-key --user-name arutech-meet-test   # note the AccessKeyId/SecretAccessKey
```

Fill in `.env.lightsail`:

```
S3_ENDPOINT=https://s3.amazonaws.com
S3_PUBLIC_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=arutech-meet-test-recordings
S3_ACCESS_KEY=<the AccessKeyId above>
S3_SECRET_KEY=<the SecretAccessKey above>
S3_FORCE_PATH_STYLE=false
S3_PUBLIC_URL=https://arutech-meet-test-recordings.s3.amazonaws.com
```

**Alternative: self-hosted MinIO (free, but recording playback won't reach a real device).** Proxying
MinIO's presigned URLs through nginx breaks AWS SigV4 signature validation (the signature covers the exact
host/path used when it was signed — see the comment on the `minio` service in
`infrastructure/docker/docker-compose.lightsail.yml`), and MinIO would need to terminate its own TLS to be
safely reachable from outside — not set up here. Pick this only if you don't care about recording playback
working from outside the instance itself:

```
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=arutech-meet-test
S3_ACCESS_KEY=<pick a value>
S3_SECRET_KEY=<openssl rand -hex 24>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=
```

...and add `--profile minio` to the `dc` alias (`alias dc='... -p arutech-meet --profile minio'`) so every
command below picks it up consistently — mixing `--profile minio` on some commands and not others is a
real footgun (Compose errors on a `depends_on` referencing a service excluded by the active profile set).

## 7. LiveKit and Egress config

Copy the templates and fill in the same key/secret you generated above:

```bash
sed -i \
  -e "s/REPLACE_WITH_LIVEKIT_API_KEY/$(grep LIVEKIT_API_KEY .env.lightsail | cut -d= -f2)/g" \
  -e "s/REPLACE_WITH_LIVEKIT_API_SECRET_MIN_32_CHARS/$(grep LIVEKIT_API_SECRET .env.lightsail | cut -d= -f2)/g" \
  infrastructure/docker/livekit.lightsail.yaml infrastructure/docker/egress.lightsail.yaml
```

Double check `infrastructure/docker/livekit.lightsail.yaml` afterward — it must have `use_external_ip:
true` (already set in the template; don't copy the local dev `livekit.yaml`, which has it `false`). This
is the single most common cause of "works on localhost, black screen on a real device": without it,
LiveKit hands out ICE candidates using its container-internal IP, which nothing on the internet can route
to.

`nginx.lightsail.conf`'s `ssl_certificate`/`ssl_certificate_key` lines also have a literal `DOMAIN`
placeholder — nginx doesn't expand environment variables in its config, and this file is bind-mounted
read-only rather than passed through envsubst, so it needs the same one-time `sed` treatment:

```bash
sed -i "s/DOMAIN/$(grep '^DOMAIN=' .env.lightsail | cut -d= -f2)/g" infrastructure/docker/nginx.lightsail.conf
```

Skipping this leaves nginx looking for a cert at `/etc/letsencrypt/live/DOMAIN/fullchain.pem` — a path
that will never exist, since certbot in step 8 issues into a directory named after your *actual* domain —
and nginx fails to start at all (`nginx -t` will point at this exact line if that happens).

## 8. TLS (Let's Encrypt via certbot, webroot mode)

nginx needs to be running (on plain HTTP) before certbot can issue a cert — its webroot mode proves domain
ownership by serving a file certbot writes, over the same port 80 you already opened in step 3. Chicken,
egg: bring nginx up first with a **self-signed placeholder cert** so it can start at all (its config
requires *some* cert file to exist to bind port 443), get the real one, then reload nginx pointed at it.

```bash
# 1. Self-signed placeholder so nginx can start
DOMAIN=$(grep '^DOMAIN=' .env.lightsail | cut -d= -f2)
mkdir -p /tmp/certbot-bootstrap && cd /tmp/certbot-bootstrap
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout privkey.pem -out fullchain.pem -subj "/CN=$DOMAIN"
docker volume create arutech-meet_certbot-conf
docker run --rm -v arutech-meet_certbot-conf:/certs -v /tmp/certbot-bootstrap:/bootstrap alpine \
  sh -c "mkdir -p /certs/live/$DOMAIN && cp /bootstrap/*.pem /certs/live/$DOMAIN/"
cd ~/arutech-meet

# 2. Bring the real stack up (nginx now has *a* cert, even if not a trusted one yet)
dc up -d nginx api web livekit egress redis postgres

# 3. Issue the real cert via webroot (nginx is already serving /.well-known/acme-challenge/ from the
#    certbot-www volume, per nginx.lightsail.conf)
dc --profile certbot run --rm certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email you@yourdomain.com --agree-tos --non-interactive

# 4. Reload nginx to pick up the real cert
dc exec nginx nginx -s reload
```

Verify: `curl -vI https://$DOMAIN 2>&1 | grep -i "issuer\|subject"` should show Let's Encrypt, not your
placeholder's `/CN=...`.

### Renewal

Let's Encrypt certs last 90 days. Add a cron job (adjust the `cd`/alias expansion — cron doesn't source
your `.bashrc`, so this spells `dc` back out in full rather than relying on the alias):

```bash
( crontab -l 2>/dev/null; echo "0 3 * * 1 cd \$HOME/arutech-meet && docker compose -f infrastructure/docker/docker-compose.lightsail.yml --env-file .env.lightsail -p arutech-meet --profile certbot run --rm certbot renew --webroot -w /var/www/certbot && docker compose -f infrastructure/docker/docker-compose.lightsail.yml --env-file .env.lightsail -p arutech-meet exec nginx nginx -s reload" ) | crontab -
```

## 9. Build and start everything

```bash
cd ~/arutech-meet
dc up -d --build
```

First run builds the API and web images from source (a few minutes — this is the same
`infrastructure/docker/{api,web}.Dockerfile` used everywhere else in this repo, not something new to this
deployment). Once it's up, run the migration and seed the same way `README.md`'s local setup does, just
targeting this instance's Postgres:

```bash
dc exec api sh -c "cd /workspace && pnpm --filter @arutech/database exec prisma migrate deploy"

# Optional — creates owner@arutech.dev / admin@arutech.dev / guest@arutech.dev, all Password123!.
# Fine for initial testing; change or remove these before leaving this instance up for anyone else to find.
dc exec api sh -c "cd /workspace && pnpm --filter @arutech/database exec tsx prisma/seed.ts"
```

## 10. Verify

```bash
curl -s https://$DOMAIN/health   # {"status":"ok","dependencies":{"postgres":"ok","redis":"ok"}}
```

Then open `https://meet-test.yourdomain.com` in a real browser — not curl, not this environment. Register,
create a meeting, and actually turn your camera on. This is the point of the whole exercise: confirm the
padlock is present (real cert, no browser warning) and the camera preview actually shows your face, not a
permission-denied error.

## 11. Real-device testing

**Web, from a phone or another laptop:** just open `https://meet-test.yourdomain.com` in its browser. No
code changes — this is the entire reason for standing up a real domain + TLS instead of testing over
`http://<lightsail-ip>:3000`, which cameras refuse to activate on.

**Mobile app (React Native), on a physical device or emulator:** the app has no `.env`-driven config yet —
`apps/mobile/src/lib/env.ts` hardcodes `localhost`/`10.0.2.2` for local dev (see the comment in that file
for exactly why, and the `docs/roadmap.md` note that `react-native-config` is the tracked follow-up, not
silently skipped). Point it at this instance by editing that file directly:

```ts
export const env = {
  apiUrl: 'https://meet-test.yourdomain.com',
  wsUrl: 'wss://meet-test.yourdomain.com',
  livekitUrl: 'wss://meet-test.yourdomain.com:7880',
};
```

Rebuild the app (`pnpm --filter @arutech/mobile android`, or open the iOS project in Xcode) and install it
on the device. Revert this file before merging anything — it's a real-device-testing edit, not meant to
land as the new default.

## Troubleshooting

- **Camera/mic permission prompt never appears, or silently fails.** You're on plain HTTP, or the
  certificate didn't actually apply — check `curl -vI https://$DOMAIN` shows a Let's Encrypt cert, and
  that you're testing the `https://` URL, not `http://`.
- **You can see yourself but not the other participant (or vice versa) — a real "black screen" while local
  testing worked fine.** Almost always `use_external_ip: false` left over from copying the wrong LiveKit
  config, or the UDP 50000-50100 firewall rule from step 3 missing/wrong. Check `dc logs livekit` for
  ICE-gathering errors mentioning a private IP (`10.x`/`172.x`/`192.168.x`) instead of the instance's
  public one.
- **`dc up` fails claiming a service depends on an undefined service.** You added `--profile minio`
  inconsistently — go back to §Storage and put it in the `dc` alias itself so every command picks it up,
  rather than appending it ad hoc to some commands and not others.
- **Recording never leaves "Processing".** If you're on the MinIO profile, this may be the presigned-URL
  limitation described in §Storage rather than a bug — check `dc logs egress` for upload errors first,
  then confirm you're not expecting playback to work from outside the instance on that path.
- **502 from nginx.** `dc ps` — confirm `api`/`web` are actually `Up`, not restarting. `dc logs api` for a
  crash-on-boot (usually a missing/wrong var in `.env.lightsail`).

## Updating

```bash
cd ~/arutech-meet
git pull
dc up -d --build
dc exec api sh -c "cd /workspace && pnpm --filter @arutech/database exec prisma migrate deploy"
```

## Teardown

Lightsail bills hourly for as long as the instance exists, running or not (stopped instances still hold
their disk). When you're done testing:

```bash
dc down -v
```

...then delete the instance and its static IP from the Lightsail console (the static IP has its own small
hourly charge once detached from a running instance).

## What was and wasn't verified writing this

Consistent with how `docs/deployment.md` reports on the Kubernetes/Terraform path: `docker-compose.lightsail.yml`
was validated for real with `docker compose config` (both with and without `--profile minio`, and with an
explicit `-p arutech-meet` confirming the volume-naming this doc's TLS bootstrap step relies on), and
`nginx.lightsail.conf` passed a real `nginx -t`. Both `infrastructure/docker/api.Dockerfile` and
`web.Dockerfile` were actually rebuilt against the current source (not assumed still-working from when
they were first built in an earlier stage) and run — the production API container came up healthy against
real Postgres/Redis/LiveKit and correctly listed every route added since, including
`NotesController`/`ContactsController`/`SearchController`; the production web container served real pages
from the real optimized build. That build caught a genuine bug: `apps/web/public/` didn't exist in this
repo at all, which `next build` tolerates but the Dockerfile's `COPY --from=build .../apps/web/public ...`
doesn't — fixed by adding the directory for real (a favicon and `robots.txt`), not by loosening the
Dockerfile to permit its absence. That directory's absence is also the explanation for a stray 404 console
error visible in every screenshot-driven verification pass earlier in this project's history — always
assumed to be the favicon, now confirmed.

**Not verified**: an actual Lightsail instance, a real domain, or a real Let's Encrypt issuance — this
environment has no AWS account or real DNS to test against, the same honest limitation
`docs/deployment.md` already discloses for the Terraform/EKS path. The steps above follow AWS's and Let's
Encrypt's own documented flows exactly (webroot ACME validation, IAM-scoped S3 access keys), but "actually
provisioned a Lightsail instance and joined a call from a phone" is the natural next verification step for
whoever runs this for real.
