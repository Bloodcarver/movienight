#!/bin/sh
# Körs varje gång nginx-containern startar. Skapar den hemliga sökvägen (första gången)
# och bygger nginx-konfigurationen och QR-sidan utifrån .env.
set -eu

SECRET_DIR=${SECRET_DIR:-/secret}
SRC=${SRC_DIR:-/filmkvall}
OUT=${OUT_DIR:-/filmkvall/generated}
NGINX_CONF=${NGINX_CONF:-/etc/nginx/conf.d/default.conf}
SECRET_FILE=$SECRET_DIR/secret.txt
mkdir -p "$OUT" "$SECRET_DIR"

# --- Hemlig sökväg ---
if [ -n "${APP_SECRET:-}" ]; then
  SECRET=$(printf '%s' "$APP_SECRET" | tr -dc 'A-Za-z0-9')
elif [ -s "$SECRET_FILE" ]; then
  SECRET=$(tr -dc 'A-Za-z0-9' < "$SECRET_FILE")
else
  SECRET=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
  printf '%s\n' "$SECRET" > "$SECRET_FILE"
  echo "Filmkväll: skapade en ny hemlig sökväg i $SECRET_FILE"
fi
if [ ${#SECRET} -lt 12 ]; then
  echo "Filmkväll: FEL - hemligheten måste vara minst 12 tecken (A-Z, a-z, 0-9)." >&2
  exit 1
fi

# --- Jellyfin ---
JF=$(printf '%s' "${JELLYFIN_URL:-}" | sed 's:/*$::')
JFKEY=$(printf '%s' "${JELLYFIN_API_KEY:-}" | tr -dc 'A-Za-z0-9')
if [ -z "$JF" ] || [ -z "$JFKEY" ]; then
  echo "Filmkväll: VARNING - JELLYFIN_URL eller JELLYFIN_API_KEY saknas i .env" >&2
  JF=${JF:-http://127.0.0.1:9}
fi
case "$JF" in http://*|https://*) ;; *) echo "Filmkväll: FEL - JELLYFIN_URL måste börja med http:// eller https://" >&2; exit 1;; esac

# --- Publik adress (används i QR-koderna) ---
PUBLIC=$(printf '%s' "${PUBLIC_URL:-}" | sed 's:/*$::')
if [ -n "$PUBLIC" ] && ! printf '%s' "$PUBLIC" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
  echo "Filmkväll: FEL - PUBLIC_URL ska se ut som https://film.example.se (utan sökväg)" >&2
  exit 1
fi
VERSION=$(printf '%s' "${APP_VERSION:-dev}" | tr -dc 'A-Za-z0-9.' | cut -c1-7)
printf 'window.FILMKVALL_PUBLIC_URL = "%s";\nwindow.FILMKVALL_VERSION = "%s";\n' "$PUBLIC" "$VERSION" > "$OUT/public.js"
echo "Filmkväll: version $VERSION"

# --- Nätverk som får se QR-sidan, och betrodda proxyer ---
valid_net() { printf '%s' "$1" | grep -Eq '^[0-9a-fA-F:.]+(/[0-9]{1,3})?$'; }

QR_LINES=""
for n in $(printf '%s' "${QR_ALLOWED_NETWORK:-192.168.0.0/24}" | tr ',' ' '); do
  valid_net "$n" || { echo "Filmkväll: ogiltigt nät i QR_ALLOWED_NETWORK: $n" >&2; exit 1; }
  QR_LINES="${QR_LINES}    $n 1;\\n"
done

RIP_LINES=""
for n in $(printf '%s' "${TRUSTED_PROXY:-}" | tr ',' ' '); do
  valid_net "$n" || { echo "Filmkväll: ogiltig adress i TRUSTED_PROXY: $n" >&2; exit 1; }
  RIP_LINES="${RIP_LINES}    set_real_ip_from $n;\\n"
done

# --- DNS för Jellyfin-adresser med namn ---
RESOLVER=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
case "$RESOLVER" in
  "") RESOLVER=1.1.1.1 ;;
  *:*) RESOLVER="[$RESOLVER]" ;;
esac

# --- Bygg filerna ---
awk -v s="$SECRET" -v ver="$VERSION" -v dns="$RESOLVER" -v jf="$JF" -v k="$JFKEY" -v qr="$QR_LINES" -v rip="$RIP_LINES" '
  /^#__QR_NETS__/ { printf "%s", qr; next }
  /^#__REAL_IP__/ { printf "%s", rip; next }
  { gsub(/__SECRET__/, s); gsub(/__VERSION__/, ver); gsub(/__RESOLVER__/, dns); gsub(/__JELLYFIN__/, jf); gsub(/__JFKEY__/, k); print }
' "$SRC/filmkvall.conf.template" > "$NGINX_CONF"

sed "s/__SECRET__/$SECRET/g" "$SRC/lan.html.template" > "$OUT/lan.html"

echo "Filmkväll: appen finns på  ${PUBLIC}/$SECRET/"
[ -n "$PUBLIC" ] || echo "Filmkväll: tips - sätt PUBLIC_URL så att QR-koderna pekar på din domän"
echo "Filmkväll: QR-sidan på /  visas för: ${QR_ALLOWED_NETWORK:-192.168.0.0/24}"
echo "Filmkväll: betrodda proxyer: ${TRUSTED_PROXY:-(inga)}"
