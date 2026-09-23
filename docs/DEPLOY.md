# DEPLOY — testing / preview environment

How the team gets a shared, always-on URL to click through the built
modules, running **fully real** — real Firebase, real Supabase, real API,
no mocks. **This is a testing deploy, not production.** Production is still
AWS ap-south-1 with RDS per the Stack table in `CLAUDE.md` — this setup
keeps the DB on Supabase and runs the API on a single free-tier EC2 box.

```
                         ┌─────────────────────────┐
  browser ─── HTTPS ────▶│  Vercel (static SPA)    │   apps/web
                         │  *.vercel.app           │
                         │  rewrites /api/* ───────┼──┐ HTTP, server-side
                         └─────────────────────────┘  │ (no browser mixed
                                                      ▼  content, no CORS)
                         ┌─────────────────────────┐
                         │  AWS EC2 t3.micro        │   apps/api
                         │  Docker · port 80        │   `node dist/main.js`
                         │  ap-south-1 (Mumbai)     │   restart=unless-stopped
                         └───────────┬─────────────┘
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
     Supabase Postgres        Firebase Auth           S3 (optional —
     (ap-northeast-1,         (project lumen-307b1)   documents only)
      Supavisor pooler)
```

Why this shape: **EC2 `t3.micro` is AWS free-tier for 12 months** (750
hrs/mo = one box 24/7); App Runner and Fargate have no free tier. The API
runs the exact `node dist/main.js` we run locally (it also runs a BullMQ
worker for the Leave queue — serverless would fight that). The SPA is a
static bundle → Vercel, free; its `/api` rewrite proxies to the box so the
app's relative `fetch('/api/...')` calls work unchanged. The
browser↔Vercel leg is HTTPS; Vercel↔EC2 is plain HTTP but server-side, so
there's no browser mixed-content and no CORS. Fine for team testing — see
"Optional: real TLS on the API" if you want to close that.

The box runs in **ap-south-1 (Mumbai)** — matching the real prod target
region (Stack table in `CLAUDE.md`) rather than sitting next to the
Supabase project, which stays in ap-northeast-1 (Tokyo) regardless of
where the EC2 box is. That means every request's 2+ DB round-trips
(`withTenantContext` sets the RLS var then queries) cross region to
Tokyo and back — noticeably slower than a same-region setup, but fine for
team testing. If you want to remove that hop, launch the box in
ap-northeast-1 instead (everything else in this guide is unchanged
either way — only the EC2 region picked in §2a moves).

---

## 0. One-time prerequisites

- An AWS account (free-tier eligible) + the **EC2 key pair** you'll SSH with.
- A Vercel account; CLI (`npm i -g vercel`) or the dashboard import flow.
- The repo reachable from the box — a GitHub PAT or deploy key for
  `git clone`, or you `scp` a tarball up.
- The Supabase connection strings + role passwords and the Firebase
  service-account JSON from the team vault (they're in your local
  `apps/api/.env` too). Never commit them.
- **Commit + push the deploy files** on the branch you're deploying
  (`dev`): `apps/api/Dockerfile`, `.dockerignore`, `apps/web/vercel.json`,
  `apps/api/src/health.controller.ts` (+ the `app.module.ts` /
  `tsconfig.build.json` edits). Vercel builds from git; the EC2 box pulls
  from git.

---

## 1. Database — already provisioned, just keep migrations current

The shared Supabase project already has every migration and the seed data
(founder `founder@hrms-platform.dev`, tenants `acme` / `beta` / `gamma`,
the 3 plans). Runtime uses the **transaction pooler** (`:6543`,
`hrms_app` / `hrms_platform`); migrations use the **session pooler**
(`:5432`, `postgres` owner).

**Only when the schema changes**, the schema owner runs this from a laptop
(a deliberate action, per `CLAUDE.md` — never from the box):

```bash
cd apps/api
DATABASE_URL='postgresql://postgres.<REF>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require' \
  npx prisma migrate deploy
```

`./scripts/dev.sh migrate` does the same thing.

---

## 2. API → AWS EC2 (free tier)

### 2a. Launch the instance

EC2 → Launch instance. (Note: only the EC2 instance moves to Mumbai — the
Supabase pooler hostnames below stay `aws-0-ap-northeast-1.pooler.supabase.com`
regardless of EC2 region; that's the shared dev DB's actual location, not a typo.)

| Setting | Value |
|---|---|
| Region | **ap-south-1** (Mumbai) |
| AMI | Amazon Linux 2023 (x86_64) |
| Type | **t3.micro** (free-tier eligible) |
| Key pair | your SSH key |
| Network | default VPC, **auto-assign public IP: enable** |
| Security group inbound | `22` from **My IP**; `80` from `0.0.0.0/0` |
| Storage | 20 GiB gp3 (within the 30 GiB free-tier limit) |

Then allocate an **Elastic IP** and associate it with the instance, so the
address survives a stop/start. (Free while attached to a running instance.)

### 2b. Set up Docker + the app

SSH in (`ssh -i <key.pem> ec2-user@<elastic-ip>`), then:

```bash
# Docker
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
exit                       # re-login so the docker group applies
# ...ssh back in...

# 2 GiB swap so `docker build` doesn't OOM on 1 GiB RAM
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Code
git clone https://github.com/AnishGrandhe29/HRMS_V2.git ~/hrms
cd ~/hrms
git checkout dev
```

Create `~/hrms/apps/api/.env` — **one `KEY=value` per line, no quotes**,
the Firebase JSON all on one line (Docker's `--env-file` is literal and
doesn't strip quotes or handle newlines):

```
DATABASE_URL=postgresql://postgres.<REF>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require
TENANT_DATABASE_URL=postgresql://hrms_app.<REF>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5
PLATFORM_DATABASE_URL=postgresql://hrms_platform.<REF>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5
FIREBASE_PROJECT_ID=lumen-307b1
FIREBASE_WEB_API_KEY=AIzaSyAWvHZ6B-iNTBlgfbroiXvSz8P_xE09tOM
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"lumen-307b1", ... }
NODE_ENV=production
PORT=3000
TENANT_RESOLUTION_MODE=header
S3_FORCE_PATH_STYLE=true
WEB_ORIGIN=https://REPLACE-AFTER-VERCEL-DEPLOY.vercel.app
```

(The 3 DB URLs are already in your laptop's `apps/api/.env` — copy them
verbatim, just strip any surrounding quotes.)

### 2c. Build + run

**Redis is required to boot, not optional** — `LeaveAccrualProcessor.onModuleInit()`
(`apps/api/src/leave/leave-accrual.processor.ts`) does
`await this.leaveQueue.upsertJobScheduler(...)` against BullMQ, which hangs
`onModuleInit` forever (never resolves, never throws) if `REDIS_URL` isn't
reachable — `app.listen()` never gets called and the API just sits there,
looking "up" in `docker ps` while `curl`ing it fails with `Connection reset
by peer`. Start Redis and put both containers on one Docker network first:

```bash
cd ~/hrms
docker network create hrms
docker run -d --name redis --restart unless-stopped --network hrms redis:7-alpine

# BuildKit isn't installed on a fresh AL2023 Docker — force the legacy builder.
DOCKER_BUILDKIT=0 docker build -f apps/api/Dockerfile -t hrms-api .

# .env must include: REDIS_URL=redis://redis:6379
docker run -d --name hrms-api --restart unless-stopped \
  --env-file apps/api/.env -p 80:3000 --network hrms hrms-api

curl http://localhost/api/health          # -> {"status":"ok",...}
```

From your laptop: `curl http://<elastic-ip>/api/health`.

(TODO for the team: wrap that `upsertJobScheduler` call with a timeout/catch
so a missing Redis degrades gracefully instead of hanging the whole API —
this doc works around the bug, it doesn't fix it.)

### Optional extras
- **S3 / document uploads.** `StorageService` fails soft without it — the
  rest of the API is fine. To enable, add `S3_ENDPOINT` / `S3_REGION` /
  `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` to `.env` (any
  S3-compatible bucket, incl. Supabase Storage's S3 endpoint).
- **ClamAV (document scanning, module 09).** Every upload stays
  `PENDING_SCAN` — shown as "Scanning…", not downloadable — until clamd has
  scanned it; scanning fails closed. The CD workflow
  (`.github/workflows/deploy-api.yml`) runs clamd as a sibling container
  named `clamav` on the `hrms` network (created once, kept across deploys,
  signature DB in the `hrms_clamav_data` volume) and starts the API with
  `CLAMAV_HOST=clamav`. clamd wants ~1–1.5 GB for its signatures, more than
  this 1 GiB box has, so it's capped at `--memory=700m` and spills into the
  2 GiB swap — scans are slower than on a bigger box, and if memory runs
  out the kernel kills clamd (it restarts), not the API. First start
  downloads signatures for a few minutes; the documents sweep scans any
  backlog once clamd is listening. If the box struggles (`free -m`,
  `docker stats`, API restarts), move to a `t3.small` or a separate clamd
  host and point `CLAMAV_HOST` at it. Production (ECS) runs clamd as its
  own service.

---

## 3. Web → Vercel

1. **Point the proxy at the box.** Edit `apps/web/vercel.json` — replace
   `REPLACE-WITH-EC2-PUBLIC-DNS` with your Elastic IP or the instance's
   public DNS (keep it `http://`, no port = 80). Commit + push.
2. **Import the project** (dashboard → Add New → Project → the repo), or
   `cd apps/web && vercel`.
   - **Root Directory: `apps/web`** (important — monorepo).
   - Framework preset: **Vite** (auto). Build/output already in `vercel.json`.
3. **Environment variables** (Settings → Environment Variables, Production +
   Preview) — the three the web bundle reads, all non-secret:
   ```
   VITE_FIREBASE_API_KEY       = AIzaSyAWvHZ6B-iNTBlgfbroiXvSz8P_xE09tOM
   VITE_FIREBASE_AUTH_DOMAIN   = lumen-307b1.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID    = lumen-307b1
   ```
   (Values from `apps/web/.env` — Vercel builds from a clean checkout so it
   needs them set explicitly.)
4. **Deploy.** Note the URL, e.g. `https://lumen-hrms.vercel.app`.

---

## 4. Wire the two together

On the box, set the real Vercel origin and restart:

```bash
cd ~/hrms
sed -i 's#^WEB_ORIGIN=.*#WEB_ORIGIN=https://<your-vercel-app>.vercel.app#' apps/api/.env
docker restart hrms-api
```

**Firebase → Authorized domains.** Firebase console → Authentication →
Settings → Authorized domains → add `<your-vercel-app>.vercel.app`, else
sign-in throws `auth/unauthorized-domain`.

---

## 5. Smoke test

| Check | How |
|---|---|
| API alive | `curl http://<elastic-ip>/api/health` |
| SPA loads | open the Vercel URL |
| Proxy works | DevTools → Network → a `/api/...` call returns JSON, not the SPA HTML |
| No mocks | Network calls hit `/api/...` (not fixture data). Ensure `VITE_LEAVE_MOCK=false` was set before the Vercel build, else Leave still shows fixtures |
| Platform Admin | `/platform-admin`, sign in as `founder@hrms-platform.dev` (reset via the Firebase email if needed) |
| Tenant app | workspace `acme` / `beta` / `gamma`, sign in as a seeded user |

Seeded logins + the founder are already in Firebase + Supabase — no reseed
needed. A clean reseed is an owner action from a laptop:
`cd apps/api && DATABASE_URL=<session-pooler> npm run prisma:seed`.

---

## 6. Redeploying

**API — automatic.** `.github/workflows/deploy-api.yml` SSHes into the box
and re-runs the build/run steps below on every push to `dev`. Needs two
repo secrets (Settings → Secrets and variables → Actions): `EC2_HOST` (the
Elastic IP) and `EC2_SSH_KEY` (the full contents of the `.pem` key) — add
these directly in the GitHub UI, never paste a private key elsewhere.

**API — manual** (SSH to the box, same thing the workflow runs):

```bash
cd ~/hrms && git pull
DOCKER_BUILDKIT=0 docker build -f apps/api/Dockerfile -t hrms-api .
docker rm -f hrms-api
docker run -d --name hrms-api --restart unless-stopped \
  --env-file apps/api/.env -p 80:3000 --network hrms hrms-api
```

**Web:** push to the tracked branch → Vercel auto-builds. Or `vercel --prod`
from `apps/web`.

**Schema changed:** run `prisma migrate deploy` (§1) from a laptop
**before** rebuilding the API.

---

## Optional: real TLS on the API

Only if you want to close the plain-HTTP hop or need it for a stricter
setup:

- Point a subdomain (`api.yourdomain.com`) at the Elastic IP, open `443` in
  the security group, and run **Caddy** on the box as a reverse proxy —
  it auto-provisions a Let's Encrypt cert. Then set the `vercel.json`
  destination to `https://api.yourdomain.com/api/:path*`.
- Or run a **Cloudflare Tunnel** (`cloudflared`) container — free HTTPS
  hostname, no inbound ports, no cert management.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/api/*` returns the SPA's `index.html` | `vercel.json` rewrite host wrong / still the placeholder. Fix + redeploy web. |
| `auth/unauthorized-domain` on sign-in | Add the Vercel domain to Firebase Authorized domains (§4). |
| Vercel build/deploy OK but `/api` calls time out | Security group isn't allowing `80` from `0.0.0.0/0`, or the container isn't running (`docker ps`), or you used the instance's *private* IP in `vercel.json`. |
| API 500s on every DB call, logs `password authentication failed` | Wrong role/password in `TENANT_`/`PLATFORM_DATABASE_URL`. Fix `.env`, `docker restart hrms-api`. |
| API logs `Can't reach database server` | Using the direct `db.<ref>.supabase.co` host (IPv6-only) instead of `*.pooler.supabase.com`. Use the pooler. |
| `prisma migrate deploy` hangs / P1001 | Use the **session** pooler (`:5432`), not the transaction pooler (`:6543`) — no DDL over `:6543`. |
| `docker build` killed / OOM | The 2 GiB swap step (§2b) wasn't done, or free-tier storage is full (`df -h`). |
| `docker build` errors `BuildKit ... buildx missing` | Prefix with `DOCKER_BUILDKIT=0`. |
| Container exits immediately | `docker logs hrms-api` — usually a quoted value or a multi-line `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env`. One line, no quotes. |
| First request after idle a bit slow | t3.micro is burstable; a cold Node process warms in ~1 s. Not a spin-down — the container stays up. |
| Document upload fails, rest fine | S3 not configured (§2, optional). Expected. |

## Known limits of this environment

- **Not production.** Single box, no load balancer, no WAF, no autoscaling,
  no backups beyond Supabase's own. A crash → downtime until
  `--restart unless-stopped` brings the container back (seconds); an
  instance reboot → back automatically (Docker service is enabled).
- **API reachable over plain HTTP** at the Elastic IP. Every real route
  needs a valid Firebase token; `/api/health` leaks nothing. Close it with
  the TLS options above if that's not acceptable.
- **Free tier is 12 months.** After that a `t3.micro` is ~$7.50/mo, or move
  to the real ap-south-1 + RDS build.
- **Secrets.** The Firebase service-account key and Supabase/role passwords
  in git history / the chat transcript still need rotating — see
  `CLAUDE.md` / the team vault. Rotate before this URL goes near a real
  customer.
