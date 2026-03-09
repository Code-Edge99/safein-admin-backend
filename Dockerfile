# ── Build Stage ──
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY smombie-admin-backend/package*.json ./
COPY smombie-admin-backend/scripts ./scripts
COPY smombie-prisma /smombie-prisma
RUN npm ci

COPY smombie-prisma/prisma ./prisma
COPY smombie-admin-backend/ ./
RUN npx prisma generate --schema ./prisma/schema.prisma
RUN npm run build

# ── Production Stage ──
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl tzdata

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/main"]
