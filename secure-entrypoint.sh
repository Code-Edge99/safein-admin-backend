#!/bin/sh
set -e

if [ "${DEPLOY_PASSWORD:-}" != "2323" ]; then
  echo "[security] DEPLOY_PASSWORD mismatch. Container start blocked."
  exit 1
fi

if [ "${RUN_DB_MIGRATE:-true}" = "true" ]; then
  echo "[startup] running prisma migrate deploy"
  npx prisma migrate deploy --schema ./prisma/schema.prisma
fi

exec "$@"
