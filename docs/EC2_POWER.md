# On-demand EC2 box (start / auto-stop)

Testing box only. The Hyderabad `t4g.micro` (`i-0386c6f2728b5e4bb`, EIP
`16.113.76.65`, ap-south-2) is started by hand and stops itself after 30
minutes without real traffic. The IP and disk persist while stopped.

## Parts
| Piece | Where |
|---|---|
| Lambda `hrms-ec2-power` (Python) | **ap-south-1** — Function URLs are not available in ap-south-2; its clients still target ap-south-2 via `REGION` |
| Bookmark page + `start` / `stop` / `status` | the Lambda's Function URL, guarded by the shared `x-token` (Lambda env var `TOKEN`, kept in the team vault — never in git) |
| EventBridge rule `hrms-auto-stop` (every 5 min) | ap-south-1, input `{"action":"auto-stop"}` |
| SNS topic `hrms-box` (email) | ap-south-2 |
| API metric `HRMS/ApiRequests` | `apps/api/src/common/activity-metric.ts` |

## Behaviour
- **Start** works only on a stopped instance; **Stop** only on a running one.
  Each emails once. A start with no capacity (`InsufficientInstanceCapacity`)
  retries briefly, then emails the failure.
- **Auto-stop** stops the box when, over the last 30 minutes, the request
  count is 0, there are at least 25 data points, and the instance has been up
  at least 30 minutes. Missing data never stops it.
- Boot takes 1–2 minutes; while stopped, the Vercel `/api` proxy returns 5xx.
- Background jobs (nightly attendance, accrual, email queue) only run while the box is up.

## API side
`ACTIVITY_METRIC_ENABLED=true` in `~/HRMS_V2/apps/api/.env` on the box turns on
the publisher (health checks don't count; zeros are published). It uses the
container's default AWS credentials — the `mailsender` user — which needs
`cloudwatch:PutMetricData` on namespace `HRMS` (inline policy `activity-metric`).

## Operations
- Rotate the token: update the Lambda's `TOKEN` env var, share the new one.
- **CD handles a stopped box.** `deploy-api.yml` first asks the Lambda for the
  state. If the box is stopped it starts it, waits until `/api/health` is up
  (max 10 min), deploys, then stops it again (even if the deploy failed). A box
  that was already running is left running. Needs repo secrets `EC2_POWER_URL`
  (the Function URL) and `EC2_POWER_TOKEN`. Runs are serialized
  (`concurrency: deploy-api`). The stop sends a "Stopped manually" email.
- Billing while stopped: the Elastic IP and the EBS volume only (~$5.5/mo).
