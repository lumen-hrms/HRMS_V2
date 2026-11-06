#!/usr/bin/env bash
#
# Manage the preview API's environment (apps/api/.env on the EC2 box,
# docs/DEPLOY.md) from your laptop — no AWS console, no hand-editing.
#
# Usage:
#   ./scripts/api-env.sh list                 # variable NAMES on the box (never values)
#   ./scripts/api-env.sh set NAME             # prompts for the value (hidden), then restarts the API
#   ./scripts/api-env.sh set NAME --local     # …and writes the same value to your apps/api/.env
#   ./scripts/api-env.sh unset NAME           # removes it, then restarts the API
#   ./scripts/api-env.sh restart              # re-apply apps/api/.env without changing anything
#   Add --no-restart to `set`/`unset` to stage several changes, then run `restart` once.
#   Piping works too:  openssl rand -base64 32 | ./scripts/api-env.sh set FIELD_ENCRYPTION_KEY
#
# Config (env vars, all optional):
#   HRMS_EC2_HOST     default: the box address in apps/web/vercel.json
#   HRMS_SSH_KEY      default: ~/.ssh/hrms-key.pem
#   HRMS_REMOTE_DIR   default: ~/HRMS_V2 (where deploy-api.yml checks the repo out)
#
# Why a restart recreates the container: Docker reads --env-file only when a
# container is CREATED, so `docker restart` would keep the old values. The
# new container is built from the running one's exact image and env (which
# also holds the secrets deploy-api.yml passes from GitHub), with only the
# changed variable swapped — then health-checked, and rolled back to the
# previous container if it doesn't come up.
#
# The value never appears in a command line or in shell history: it travels
# base64-encoded inside the script piped over SSH's stdin.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Variables deploy-api.yml forwards from GitHub secrets on every deploy —
# changing one here works until the next deploy, which re-applies the
# GitHub value (if that secret is set).
GITHUB_FORWARDED="S3_ENDPOINT S3_REGION S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET SES_REGION SES_FROM_ADDRESS AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY APP_BASE_URL RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET"

usage() { sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }

ACTION="${1:-}"; [ -n "$ACTION" ] || usage
shift
NAME=""
LOCAL=0
RESTART=1
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=1 ;;
    --no-restart) RESTART=0 ;;
    -*) echo "Unknown option: $arg" >&2; usage ;;
    *) [ -z "$NAME" ] && NAME="$arg" || usage ;;
  esac
done

HOST="${HRMS_EC2_HOST:-$(grep -oE 'http://[0-9.]+' apps/web/vercel.json | head -1 | sed 's#http://##')}"
SSH_KEY="${HRMS_SSH_KEY:-$HOME/.ssh/hrms-key.pem}"
REMOTE_DIR="${HRMS_REMOTE_DIR:-~/HRMS_V2}"
[ -n "$HOST" ] || { echo "Set HRMS_EC2_HOST — no box address found in apps/web/vercel.json." >&2; exit 1; }
[ -f "$SSH_KEY" ] || { echo "SSH key not found at $SSH_KEY (set HRMS_SSH_KEY)." >&2; exit 1; }

case "$ACTION" in
  set|unset)
    [[ "$NAME" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "NAME must be UPPER_SNAKE_CASE, e.g. FIELD_ENCRYPTION_KEY" >&2; exit 1; } ;;
  list|restart) [ -z "$NAME" ] || usage ;;
  *) usage ;;
esac

VALUE=""
if [ "$ACTION" = set ]; then
  if [ -t 0 ]; then
    read -r -s -p "Value for $NAME (hidden): " VALUE; echo
  else
    IFS= read -r VALUE || true
  fi
  # Trim surrounding whitespace — a pasted trailing space is never intended.
  VALUE="${VALUE#"${VALUE%%[![:space:]]*}"}"
  VALUE="${VALUE%"${VALUE##*[![:space:]]}"}"
  [ -n "$VALUE" ] || { echo "Empty value — nothing changed. Use 'unset' to remove a variable." >&2; exit 1; }
fi

if [ "$ACTION" != list ] && [ "$ACTION" != restart ] && [[ " $GITHUB_FORWARDED " == *" $NAME "* ]]; then
  echo "Note: $NAME is also forwarded from a GitHub secret by deploy-api.yml." >&2
  echo "      If that secret is set, the next deploy re-applies it — update it in GitHub too." >&2
fi

# Upserts / removes NAME in a KEY=value env file, keeping its permissions.
# Shared by the remote script below (sent verbatim) and the --local write.
ENV_FUNCS='
env_upsert() { # file name value
  local tmp; tmp="$(mktemp)"
  grep -v "^$2=" "$1" > "$tmp" || true
  printf "%s=%s\n" "$2" "$3" >> "$tmp"
  cat "$tmp" > "$1"; rm -f "$tmp"
}
env_remove() { # file name
  local tmp; tmp="$(mktemp)"
  grep -v "^$2=" "$1" > "$tmp" || true
  cat "$tmp" > "$1"; rm -f "$tmp"
}
'

VALUE_B64="$(printf '%s' "$VALUE" | base64 | tr -d '\n')"

remote_script() {
  cat <<REMOTE
set -euo pipefail
$ENV_FUNCS
ACTION='$ACTION'; NAME='$NAME'; RESTART=$RESTART
VALUE="\$(printf '%s' '$VALUE_B64' | base64 -d)"
cd $REMOTE_DIR
ENV_FILE=apps/api/.env
[ -f "\$ENV_FILE" ] || { echo "No \$ENV_FILE on the box" >&2; exit 1; }

if [ "\$ACTION" = list ]; then
  echo "In \$ENV_FILE:"
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "\$ENV_FILE" | cut -d= -f1 | sort | sed 's/^/  /'
  if docker inspect hrms-api >/dev/null 2>&1; then
    echo "Set on the running container only (from deploy-api.yml / GitHub secrets):"
    docker inspect hrms-api --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1 \
      | grep -vxE 'PATH|NODE_VERSION|YARN_VERSION|HOME|HOSTNAME' | sort \
      | comm -23 - <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "\$ENV_FILE" | cut -d= -f1 | sort) | sed 's/^/  /'
  fi
  exit 0
fi

if [ "\$ACTION" != restart ]; then
  # Keep the last 5 backups of the box's .env.
  cp -p "\$ENV_FILE" "\$ENV_FILE.bak.\$(date +%Y%m%d-%H%M%S)"
  ls -1t "\$ENV_FILE".bak.* 2>/dev/null | tail -n +6 | xargs -r rm -f
  if [ "\$ACTION" = set ]; then env_upsert "\$ENV_FILE" "\$NAME" "\$VALUE"; echo "Saved \$NAME in \$ENV_FILE."
  else env_remove "\$ENV_FILE" "\$NAME"; echo "Removed \$NAME from \$ENV_FILE."; fi
fi

if [ "\$RESTART" != 1 ]; then echo "Not restarted — run './scripts/api-env.sh restart' to apply."; exit 0; fi
docker inspect hrms-api >/dev/null 2>&1 || { echo "No hrms-api container — deploy first (deploy-api.yml)." >&2; exit 1; }

# The running container's env (its .env values + GitHub-forwarded secrets +
# fixed flags), overlaid with the current .env — the .env wins, so 'set'
# and 'unset' both take effect while nothing else is lost.
work="\$(mktemp -d)"; trap 'rm -rf "\$work"' EXIT
docker inspect hrms-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -v '^\$' > "\$work/env"
while IFS= read -r line; do
  case "\$line" in ''|'#'*) continue ;; esac
  key="\${line%%=*}"
  env_upsert "\$work/env" "\$key" "\${line#*=}"
done < "\$ENV_FILE"
[ "\$ACTION" = unset ] && env_remove "\$work/env" "\$NAME"
IMAGE="\$(docker inspect hrms-api --format '{{.Image}}')"
RUN_ARGS=(--restart unless-stopped --env-file "\$work/env" -p 80:3000 --network hrms "\$IMAGE")

# Same safety net as deploy-api.yml: validate the run command before
# touching the live container.
docker rm -f hrms-api-check >/dev/null 2>&1 || true
docker create --name hrms-api-check "\${RUN_ARGS[@]}" >/dev/null
docker rm hrms-api-check >/dev/null

echo "Restarting the API with the new environment…"
docker rm -f hrms-api-prev >/dev/null 2>&1 || true
docker rename hrms-api hrms-api-prev
docker stop hrms-api-prev >/dev/null
docker run -d --name hrms-api "\${RUN_ARGS[@]}" >/dev/null

for i in \$(seq 1 30); do
  if curl -fsS http://localhost/api/health >/dev/null 2>&1; then
    docker rm hrms-api-prev >/dev/null
    echo "API is healthy with the new environment."
    exit 0
  fi
  sleep 5
done

echo "API not healthy after ~150s — rolling back to the previous container." >&2
docker logs --tail 40 hrms-api >&2 || true
docker rm -f hrms-api >/dev/null
docker rename hrms-api-prev hrms-api
docker start hrms-api >/dev/null
echo "Rolled back. The .env change is still saved on the box (a backup is next to it) — fix or 'unset' it." >&2
exit 1
REMOTE
}

echo "Connecting to ec2-user@$HOST…"
remote_script | ssh -i "$SSH_KEY" -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new \
  "ec2-user@$HOST" 'bash -s'

if [ "$LOCAL" = 1 ] && [ "$ACTION" != list ] && [ "$ACTION" != restart ]; then
  eval "$ENV_FUNCS"
  LOCAL_ENV=apps/api/.env
  [ -f "$LOCAL_ENV" ] || { echo "No local $LOCAL_ENV — skipped." >&2; exit 0; }
  if [ "$ACTION" = set ]; then env_upsert "$LOCAL_ENV" "$NAME" "$VALUE"; else env_remove "$LOCAL_ENV" "$NAME"; fi
  echo "Also updated your local $LOCAL_ENV — restart your local API to pick it up."
fi
