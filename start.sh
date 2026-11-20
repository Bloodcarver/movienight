#!/bin/sh
# Startar PocketBase och nginx i samma container. Om någon av dem dör
# avslutas containern, så att Docker/Unraid kan starta om den.
set -e

mkdir -p /data/pb_data /data/secret

sh /filmkvall/setup.sh

ARGS="--dir=/data/pb_data --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks"

if [ -n "${PB_ADMIN_EMAIL:-}" ] && [ -n "${PB_ADMIN_PASSWORD:-}" ]; then
  /pb/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" $ARGS
fi

/pb/pocketbase serve --http=0.0.0.0:8090 $ARGS &
PB_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

stop() {
  kill -TERM "$PB_PID" "$NGINX_PID" 2>/dev/null || true
  wait
  exit 0
}
trap stop TERM INT

while kill -0 "$PB_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 2
done

echo "Filmkväll: PocketBase eller nginx avslutades, stänger containern." >&2
kill -TERM "$PB_PID" "$NGINX_PID" 2>/dev/null || true
wait
exit 1
