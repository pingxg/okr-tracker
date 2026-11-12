# One image: builds the Vue frontend and runs the Node backend, which also
# serves the built frontend.

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js babel.config.cjs ./
COPY public ./public
COPY common ./common
COPY src ./src
RUN npx vite build --mode production

FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
# pg_dump for scripts/backup.js
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY common ./common
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=web /app/dist ./dist
USER node
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "src/index.js"]
