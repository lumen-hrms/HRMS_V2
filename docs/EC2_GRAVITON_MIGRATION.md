# EC2 `t3.micro` → `t4g.micro` (Graviton / arm64) — runbook

Testing box only (see `DEPLOY.md`). Not the production target.

**Why:** the box is ~1% CPU on average (14-day CloudWatch), so it doesn't need
x86. `t4g.micro` has the same 2 vCPU / 1 GiB and costs $0.0056/h vs $0.0112/h
(ap-south-1, AWS Price List) → ~$4.17/month saved (~50%).

**Not `t4g.nano`:** 0.5 GiB. The box is already memory-tight at 1 GiB (the CD
workflow stops ClamAV to build, and ClamAV is capped at 700 MB with swap).

## Status (2026-11-06) — region changed to Hyderabad

`t4g.micro` had **no capacity in any ap-south-1 AZ** (`InsufficientInstanceCapacity`),
so the target is **ap-south-2 (Hyderabad)** — same price ($0.0056/h), already
enabled on the account. Tokyo/Singapore/Sydney also had capacity but cost ~2x.

Done in ap-south-2 (VPC `vpc-0e833c6b3b19dbbf0`): instance `i-0386c6f2728b5e4bb`
(`t4g.micro`, AL2023 arm64, AZ b, tag `hrms-api`), Elastic IP `16.113.76.65`
(`eipalloc-08b9520739815296c`), security group `sg-0b3c1c587208060c4`
(80 + 22 from anywhere, mirroring the old box so the CD workflow can SSH in),
key pair `hrms-key` (public key imported from the old box). Repo, GitHub deploy
key and runtime env copied from the old box; image built natively on arm64
(`node` reports `arm64`), API healthy, DB reachable, **workers OFF** and
`DOCUMENT_SCANNING_ENABLED=false` (no ClamAV).

**Remaining (the traffic switch):** steps 7–9 below, with "same subnet / ap-south-1"
read as ap-south-2. Old box `i-07f6701bffc34cfa1` (ap-south-1, `t3.micro`) is
untouched and still serving. The CD workflow must not target the new box until
the `stable-debian` / `DOCUMENT_SCANNING_ENABLED` workflow changes are on `dev`.

## What was checked (arm64 readiness)

| Item | Result |
|---|---|
| `node:22-bookworm-slim` | multi-arch (amd64 + arm64) ✅ |
| `redis:7-alpine` | multi-arch ✅ |
| `clamav/clamav:stable` | **amd64 only ❌** → workflow now uses `stable-debian` (amd64 + arm64) |
| Prisma 5.22 | auto-detects `linux-arm64-openssl-3.0.x` on bookworm; downloads engine at `npm ci` / `prisma generate` ✅ |
| Native npm deps | only `msgpackr-extract` (ships `linux-arm64` prebuild) and `protobufjs`/`@nestjs/core` (JS only) ✅ |
| `apps/api/Dockerfile` | no arch-specific lines; builds natively on arm64, **no change needed** ✅ |

The image is built **on the box** (`docker build`, no registry), so there is
no cross-build: building on the arm64 box produces an arm64 image.

**Not verified:** a real arm64 build/run. This laptop is x86 without QEMU
emulation, so the first true test is step 4 below on the new box. Steps 4–6
are the gate; the old box keeps serving until step 7.

## Pre-flight (on the old box, `i-07f6701bffc34cfa1`)

Collect what must move. None of this is in git.

- `~/HRMS_V2/apps/api/.env` (secrets — copy over `scp`, never commit).
- Note `docker ps` (expect `hrms-api`, `redis`, `clamav`) and `docker network ls` (`hrms`).
- Redis holds only BullMQ queue state; repeatable jobs re-register on boot.
  Cut over when no payroll run / leave job is mid-flight.
- ClamAV signatures live in the `hrms_clamav_data` volume — not copied; the new
  box re-downloads them (a few minutes). Uploads wait in `PENDING_SCAN` meanwhile.

## Cutover

### 1. Launch the new instance (don't touch the old one)

| Setting | Value |
|---|---|
| Region / AZ | ap-south-1, same subnet `subnet-018031b435dc4153d` (ap-south-1b) |
| AMI | AL2023 **arm64**: `aws ssm get-parameter --region ap-south-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text` (was `ami-06a2808e9776c45eb` on 2026-11-06 — re-resolve, don't hardcode) |
| Type | `t4g.micro` |
| Key pair | `hrms-key` |
| Security group | `sg-0821a168f01a12e24` (same as old). Better: change port 22 from `0.0.0.0/0` to your IP |
| Storage | 20 GiB gp3 (root `/dev/xvda`) |
| Credits | `--credit-specification CpuCredits=unlimited` is the t3/t4g default; fine (balance was pinned at max, no surplus ever charged) |
| Public IP | auto-assign on; step 8 pins it |

### 2. Install Docker + swap (same as `DEPLOY.md` §2b)

```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user      # re-login after
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
git clone https://github.com/AnishGrandhe29/HRMS_V2.git ~/HRMS_V2   # path the CD workflow expects
cd ~/HRMS_V2 && git checkout dev
```

### 3. Copy config, create network + Redis

```bash
# from your laptop
scp -i hrms-key.pem ec2-user@<OLD_IP>:~/HRMS_V2/apps/api/.env /tmp/api.env
scp -i hrms-key.pem /tmp/api.env ec2-user@<NEW_IP>:~/HRMS_V2/apps/api/.env && rm /tmp/api.env

# on the new box
docker network create hrms
docker run -d --name redis --restart unless-stopped --network hrms redis:7-alpine
```

### 4. Build on arm64 and verify the architecture

```bash
cd ~/HRMS_V2
DOCKER_BUILDKIT=0 docker build -f apps/api/Dockerfile -t hrms-api .
docker run --rm hrms-api uname -m                                  # expect aarch64
docker run --rm hrms-api node -e "console.log(process.arch)"       # expect arm64
```

If `prisma generate` or `msgpackr-extract` fails here, stop: the old box is
untouched, fix forward before continuing.

### 5. Start the API (workers OFF until cutover)

The old box runs the background jobs against the shared DB. Don't run two
worker sets at once.

```bash
docker run -d --name hrms-api --restart unless-stopped \
  --env-file apps/api/.env -e CLAMAV_HOST=clamav -e CLAMAV_PORT=3310 \
  -e WORKERS_ENABLED=false -p 80:3000 --network hrms hrms-api
curl -fsS http://localhost/api/health
```

### 6. Smoke test through the public IP

```bash
curl -fsS http://<NEW_IP>/api/health
```

Then sign in through a temp Vercel preview pointing at `<NEW_IP>` (or call an
authenticated route directly). Check `docker logs hrms-api` and `free -m`.

### 7. Cut over

1. Old box: `docker stop hrms-api` (stops its workers).
2. New box: `docker rm -f hrms-api` and rerun step 5 with
   `-e WORKERS_ENABLED=true`, plus the secret `-e` flags the CD workflow adds
   (S3_*, SES_*, AWS_*, RAZORPAY_*, APP_BASE_URL — copy from the workflow
   or simply let the CD workflow do it, see step 9).
3. Start ClamAV (arm64 tag):
   ```bash
   docker run -d --name clamav --restart unless-stopped --network hrms \
     --memory=700m --memory-swap=1800m \
     -v hrms_clamav_data:/var/lib/clamav clamav/clamav:stable-debian
   ```
4. Poll `curl http://localhost/api/health`; confirm `docker ps` shows all three.

### 8. Pin the address, update the proxy and CD

1. Allocate an Elastic IP and associate it with the new instance (public
   IPv4 is billed either way; the auto-assigned one changes on stop/start and
   would break the Vercel rewrite).
2. `apps/web/vercel.json`: change the `/api/:path*` destination from
   `http://15.206.56.164/...` to the new IP. Redeploy the web app.
3. GitHub secret `EC2_HOST` → the new IP, so the CD workflow targets the new box.
4. Re-run the CD workflow once (`workflow_dispatch`): it rebuilds, injects
   all secrets, and starts ClamAV with the right flags — this is the check
   that the pipeline works against the new box.

### 9. Verify, then retire the old box

Watch ~24 h: `docker ps`, `docker stats`, `free -m`, CloudWatch `CPUUtilization`
and `CPUSurplusCreditsCharged` (expect 0). Then:

1. Stop `i-07f6701bffc34cfa1` (keeps it restartable for rollback), wait a
   few days, then terminate. Terminating also deletes its 20 GB volume — the
   public IP is released with it.
2. Update `DEPLOY.md`: `t3.micro` → `t4g.micro`, AMI → arm64, ap-northeast-1
   → ap-south-1 wording for the EC2 region.

## Rollback

Before step 7: nothing changed, just terminate the new instance.
After: `docker stop hrms-api` on the new box, `docker start hrms-api` on the
old one (restart it first if stopped), revert `vercel.json` and `EC2_HOST`.
The old box stays as the fallback until step 9.

## Expected result

| | Before | After |
|---|---|---|
| EC2 compute | $8.33/mo | $4.17/mo |
| Public IPv4 | $3.72/mo | $3.72/mo (unchanged; one IP) |
| EBS 20 GB gp3 | $1.82/mo | $1.82/mo |
