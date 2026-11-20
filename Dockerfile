# Filmkväll: nginx + PocketBase (SQLite) i en enda container.
FROM nginx:1.27-alpine

ARG PB_VERSION=0.40.6
ARG TARGETARCH

RUN apk add --no-cache ca-certificates tzdata unzip wget \
 && ARCH="${TARGETARCH:-amd64}" \
 && wget -q -O /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip" \
 && mkdir -p /pb \
 && unzip -q /tmp/pb.zip pocketbase -d /pb \
 && rm /tmp/pb.zip \
 && apk del unzip wget \
 && rm -f /etc/nginx/conf.d/default.conf

COPY pocketbase/pb_migrations /pb/pb_migrations
COPY pocketbase/pb_hooks /pb/pb_hooks
COPY nginx/html /usr/share/nginx/html
COPY nginx/filmkvall.conf.template nginx/lan.html.template nginx/setup.sh /filmkvall/
COPY start.sh /start.sh

ENV SECRET_DIR=/data/secret \
    QR_ALLOWED_NETWORK=192.168.0.0/24 \
    TRUSTED_PROXY=172.16.0.0/12 \
    ROOM_TTL_HOURS=24 \
    CANDIDATE_COUNT=25

VOLUME /data
# 80 = appen, 8090 = PocketBase adminpanel (bara hemmanätet)
EXPOSE 80 8090

ENTRYPOINT ["/bin/sh", "/start.sh"]
