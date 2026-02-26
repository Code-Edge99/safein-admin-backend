# ── Build Stage ──
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY smombie-admin-backend/package*.json ./
RUN npm ci

COPY smombie-prisma/prisma ./prisma
COPY smombie-admin-backend/ ./
RUN npx prisma generate --schema ./prisma/schema.prisma
RUN npm run build

# ── Production Stage (Node + Nginx) ──
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl nginx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY smombie-admin-backend/nginx.conf /etc/nginx/http.d/default.conf
COPY smombie-admin-backend/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /run/nginx

EXPOSE 80 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:80/api/docs >/dev/null || exit 1

CMD ["sh", "/app/docker-entrypoint.sh"]
