FROM node:24-bookworm-slim AS build

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl libssl3 \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl libssl3 \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/instrumentation.ts ./instrumentation.ts
COPY --from=build /app/src ./src
COPY --from=build /app/config ./config

RUN npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "set -e; if [ ! -f /data/dev.db ]; then npx prisma db push && node scripts/init-db.js; else npx prisma db push; fi; npm run start"]
