# Erp Grid8 backend (NestJS + Prisma)
FROM node:20-alpine

# openssl: Prisma engines. postgresql16-client: pg_dump / pg_restore / psql
# used by the Backup & Restore feature (must match the postgres:16 server).
RUN apk add --no-cache openssl postgresql16-client

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 4000

# On boot: sync schema to the DB, seed (idempotent), then start the API.
CMD sh -c "npx prisma db push --skip-generate --accept-data-loss && npm run seed && node dist/main.js"
