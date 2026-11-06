# Infrastructure — current state and history

Reference for the **testing/preview** infrastructure (not the production
target — that is still AWS ap-south-1 + RDS per `CLAUDE.md`). Written
2026-11-06 after a series of changes: KMS removal, cost optimisation, the
move to a Graviton box in Hyderabad, document-scanning switch, and on-demand
start/stop. Secrets are **never** recorded here — they live in the team vault
and GitHub secrets.

Related: `DEPLOY.md` (original runbook), `EC2_GRAVITON_MIGRATION.md`
(migration runbook), `EC2_POWER.md` (start/stop details),
`modules/09_DOCUMENTS.md` (scanning).

---

## 1. Architecture today

```
Browser ──HTTPS──▶ Vercel (web, apps/web)
                     │  /api/*  rewrite (apps/web/vercel.json)
                     ▼ HTTP
              16.113.76.65  (Elastic IP, ap-south-2 Hyderabad)
              EC2 t4g.micro (arm64) ── Docker: hrms-api + redis
                     │
                     ├──▶ Supabase Postgres (DB, shared dev DB)
                     ├──▶ Firebase Auth
                     ├──▶ S3-compatible storage (documents)
                     └──▶ AWS SES (email)

On-demand power (ap-south-1 Mumbai):
  Function URL ─▶ Lambda hrms-ec2-power ─▶ start/stop the EC2 in ap-south-2
  EventBridge rate(5 min) ─▶ same Lambda (auto-stop after 30 idle min)
  SNS topic hrms-box (ap-south-2) ─▶ email alerts
```

ClamAV is **off** (see §4). The box is started on demand (see §6).

## 2. Resources (AWS account `282477853730`)

### ap-south-2 (Hyderabad) — the app box
| Resource | Value |
|---|---|
| Instance | `i-0386c6f2728b5e4bb`, `t4g.micro` (2 vCPU / 1 GiB, arm64), AL2023, AZ `ap-south-2b`, tag `hrms-api` |
| Elastic IP | `16.113.76.65` (`eipalloc-08b9520739815296c`) — survives stop/start |
| VPC | `vpc-0e833c6b3b19dbbf0` |
| Security group | `sg-0b3c1c587208060c4` — ports 80 and 22 open to the world |
| Key pair | `hrms-key` (public key imported from the old box; the `.pem` is **not** on the dev laptop) |
| Disk | 20 GiB gp3, plus a 2 GiB swapfile |
| Containers | `hrms-api` (port 80→3000), `redis` (BullMQ), network `hrms`. Repo at `~/HRMS_V2`, env in `~/HRMS_V2/apps/api/.env` |
| SNS topic | `arn:aws:sns:ap-south-2:282477853730:hrms-box` — email subscription confirmed |

### ap-south-1 (Mumbai) — power control
| Resource | Value |
|---|---|
| Lambda | `hrms-ec2-power` (Python 3.14, arm64, 128 MB, 30 s). Env: `INSTANCE_ID`, `INSTANCE_IP`, `TOKEN`, `REGION=ap-south-2`, `SNS_TOPIC` |
| Function URL | `https://q252dud2rhaircxdjqn77fcdn40itopc.lambda-url.ap-south-1.on.aws/` (auth NONE; every action needs the `x-token` header) |
| EventBridge rule | `hrms-auto-stop`, `rate(5 minutes)`, input `{"action":"auto-stop"}` |
| IAM role | `hrms-ec2-power` — Start/Stop on that one instance, Describe, `cloudwatch:GetMetricStatistics`, `sns:Publish` to the topic |

### IAM users
| User | Used for |
|---|---|
| `mailsender` | The app's **default AWS credentials** (`AWS_ACCESS_KEY_ID` in the deploy workflow comes from secret `SES_AWS_ACCESS_KEY_ID`). SES send. |
| `hrmss3app` | S3 documents (`S3_ACCESS_KEY` secret) |
| `anuj` | Admin (console/CLI) |

### Gone
- Old box `i-07f6701bffc34cfa1` (t3.micro, ap-south-1b, x86) **terminated** 2026-11-06; its Elastic IP `15.206.56.164` released; Mumbai now has no instances/volumes/EIPs.
- Hyderabad copy of the Lambda deleted (Function URLs aren't available there).

## 3. What was done, in order

1. **KMS audit and removal.** The app never used KMS (PII encryption is AES-256-GCM, `FIELD_ENCRYPTION_KEY`). The only KMS use was the IAM Identity Center key. Identity Center instance `ssoins-6595c2126b5d968d` was switched to an AWS-owned key and the us-west-2 additional Region removed (required first). KMS key `mrk-9c53350074254f57a2c62bdc1d676521` is scheduled for deletion: the us-west-2 replica on 2026-11-13, the ap-south-1 primary after it (a multi-Region primary shows `PendingReplicaDeletion` until the replica goes). **Check the ap-south-1 key after 2026-11-13.** KMS wording was removed from code comments and docs; the migration SQL comment was left (checksum).
2. **Billing review.** No real waste. The cost is one always-on t3.micro (~$8.33/mo), its public IPv4 (~$3.72) and disk (~$1.82). The VPC was kept deliberately (it costs nothing by itself).
3. **EC2 cost optimisation → Graviton.** t3.micro → t4g.micro (~half the compute cost; the box ran ~1% CPU). `t4g.micro` had **no capacity in any ap-south-1 AZ**; Tokyo/Singapore/Sydney had it at ~2× the price, so the target became **ap-south-2 Hyderabad** (same price). arm64 readiness was verified: node/redis/Prisma 5.22 are multi-arch, the Dockerfile needed no change.
4. **Document scanning switch.** New `DOCUMENT_SCANNING_ENABLED` flag (default on; only `false`/`0` disables). Off: uploads skip the scan queue and download as "Not scanned" (`UNSCANNED`), `INFECTED` stays blocked, the scan processor and sweep no-op. Turning it back on scans the backlog. The ClamAV image moved to `clamav/clamav:stable-debian` (multi-arch; `stable` is amd64-only). The deploy workflow skips ClamAV and stops the container when the repo **variable** is `false`.
5. **Cutover to Hyderabad.** New box built natively on arm64, verified, then: `EC2_HOST` secret → new IP, `vercel.json` rewrite → new IP (merged to `dev`), CD re-run, old API stopped, old box stopped then terminated, its EIP released.
6. **On-demand start/stop** (this section's detail is in `EC2_POWER.md`): Lambda + Function URL bookmark page, shared-secret token, EventBridge auto-stop every 5 min, SNS email on manual start / manual stop / auto-stop / failed start. Idle signal = the API's own `HRMS/ApiRequests` CloudWatch metric (health checks excluded), because network/CPU are never truly idle on this box.
7. **CD aware of the power state.** `deploy-api.yml` starts a stopped box, waits for health, deploys, then stops it again (even if the deploy failed); a running box is left running. Runs are serialized (`concurrency: deploy-api`).

## 4. Document scanning — current state
`DOCUMENT_SCANNING_ENABLED=false` (repo variable **and** the box `.env`). No ClamAV. When ClamAV returns on a separate x64 EC2 instance: set the variable to `true`, point `CLAMAV_HOST`/`CLAMAV_PORT` at it, redeploy. The sweep re-scans files uploaded in the meantime.

## 5. Costs (ap-south, per month, approx.)
| | Before | Now |
|---|---|---|
| Compute | $8.33 (t3.micro 24/7) | $4.17 if 24/7 · ~$1.46 at ~260 h on-demand |
| Public IPv4 | $3.72 | $3.72 (one Elastic IP, billed even while stopped) |
| Disk (20 GB gp3) | $1.82 | ~$1.82 (billed while stopped) |
| Lambda / EventBridge | — | ~$0 (free tier) |
| CloudWatch custom metric | — | ~$0.30 |
| SNS email | — | ~$0 (first 1,000/month free) |

While stopped you pay only for the Elastic IP and the volume (~$5.5/mo).

## 6. Day-to-day operations
- **Start/stop:** open the Function URL bookmark, enter the token (kept in the vault; the browser remembers it). The box is ready ~1–2 min after Start. Auto-stop after 30 minutes with no real requests (needs ≥25 data points and ≥30 min uptime; missing data never stops it).
- **Background jobs run only while the box is up** — nightly attendance finalization, leave accrual, renewals, audit purge and the email queue skip a night the box is off.
- **Deploy:** push/merge to `dev` runs `deploy-api.yml`; it starts the box if needed. Needs secrets `EC2_HOST`, `EC2SSHKEY`, `EC2_POWER_URL`, `EC2_POWER_TOKEN`, the S3/SES/Razorpay secrets, and the variable `DOCUMENT_SCANNING_ENABLED`.
- **SSH without the `.pem`:** push a temporary key with EC2 Instance Connect (valid 60 s), then ssh in:
  `aws ec2-instance-connect send-ssh-public-key --region ap-south-2 --instance-id i-0386c6f2728b5e4bb --availability-zone ap-south-2b --instance-os-user ec2-user --ssh-public-key file://key.pub`
- **Rotate the power token:** change `TOKEN` in the Lambda (and the `EC2_POWER_TOKEN` secret), share the new one.
- **Rollback to the old setup:** not possible — the Mumbai box is terminated. To rebuild a box, follow `EC2_GRAVITON_MIGRATION.md` (launch an arm64 AL2023 instance, Docker + swap, copy `.env`, build the image on the box).

## 7. Lessons / gotchas
- **`t4g` capacity is not guaranteed.** A stopped instance can fail to restart with `InsufficientInstanceCapacity`; the Lambda retries briefly, then emails. Fallback is a different size in the same family (the AZ is fixed by the EBS volume and the EIP).
- **Lambda Function URLs are not available in ap-south-2.** That is why the Lambda lives in Mumbai and controls Hyderabad cross-region.
- **The console shows one region at a time.** The Hyderabad box is invisible while the console is on Mumbai (and vice versa). Lambda, EventBridge, CloudWatch and SNS must match the region they act on; IAM is global.
- **ClamAV starts on every deploy unless the repo *variable* is `false`** — the app reads the flag from `.env`, but the workflow reads the GitHub variable. Both must say `false`.
- **The app's CloudWatch client uses the default AWS credential chain = the `mailsender` user** (the container has `AWS_ACCESS_KEY_ID` set), not an instance role (the instance has none).
- **Elastic IPs bill after the instance is gone.** Release them when terminating.
- **A date-dependent test** (`employee-insights.service.spec.ts`) had hardcoded 2026-10/11 dates and broke CI; it now uses dates relative to today.
- **Secrets pasted into chats/screenshots are exposed** — rotate them.

## 8. Still open
1. IAM: inline policy `activity-metric` on `mailsender` — `cloudwatch:PutMetricData` on namespace `HRMS` only. **Without it auto-stop never fires.**
2. Merge `feature/activity-metric` to `dev`; add secrets `EC2_POWER_URL` and `EC2_POWER_TOKEN`.
3. On the box: `ACTIVITY_METRIC_ENABLED=true` in `~/HRMS_V2/apps/api/.env`, re-run the deploy; confirm `HRMS/ApiRequests` appears in CloudWatch, then watch a first auto-stop and its email.
4. Set the repo variable `DOCUMENT_SCANNING_ENABLED=false`; `docker stop clamav` on the box if it is still running; confirm `Background workers: ON`.
5. KMS: confirm the ap-south-1 key is deleted after 2026-11-13.
6. Nice-to-have: a "server is waking up" screen in the web app instead of a 502; restrict SSH (port 22) from the world (CD needs it); a budget alert; stale wording in `CLAUDE.md` (says ap-northeast-1, `t3.micro`) and `DEPLOY.md`.
