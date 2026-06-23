FROM node:24-bookworm-slim AS build

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ARG SESSION_SECRET=build-only-placeholder-secret-32chars
ARG PLEX_CLIENT_ID=build-only-placeholder-client-id
ARG CI_BUILD=true

ENV DATABASE_URL=$DATABASE_URL \
	SESSION_SECRET=$SESSION_SECRET \
	PLEX_CLIENT_ID=$PLEX_CLIENT_ID \
	CI_BUILD=$CI_BUILD

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
# Default broadcast timezone. Overridable via the docker-compose `TZ` env and,
# at runtime, by the admin "Broadcast Timezone" setting (applied on startup).
ENV TZ=Australia/Sydney

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl libssl3 tzdata \
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

RUN npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "set -e; npx prisma db push; node scripts/init-db.js; npm run start"]
