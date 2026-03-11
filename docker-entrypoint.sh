#!/bin/sh
set -e

if [ -z "${LOCATION_ENCRYPTION_KEY:-}" ]; then
  echo "[security] LOCATION_ENCRYPTION_KEY is required."
  exit 1
fi

npx prisma migrate deploy --schema ./prisma/schema.prisma

node dist/main &
APP_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

cleanup() {
  kill -TERM "$APP_PID" "$NGINX_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  wait "$NGINX_PID" 2>/dev/null || true
}

trap cleanup INT TERM

while kill -0 "$APP_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 1
done

APP_EXIT=0
NGINX_EXIT=0

if ! kill -0 "$APP_PID" 2>/dev/null; then
  set +e
  wait "$APP_PID"
  APP_EXIT=$?
  set -e
fi

if ! kill -0 "$NGINX_PID" 2>/dev/null; then
  set +e
  wait "$NGINX_PID"
  NGINX_EXIT=$?
  set -e
fi

cleanup

if [ "$APP_EXIT" -ne 0 ]; then
  exit "$APP_EXIT"
fi

if [ "$NGINX_EXIT" -ne 0 ]; then
  exit "$NGINX_EXIT"
fi

exit 0
