FROM node:20-alpine AS builder

WORKDIR /app
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# Copy workspace configuration
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy project package.json files
COPY core/package.json ./core/
COPY web/package.json ./web/

# Install all deps for build
RUN pnpm config set registry https://registry.npmmirror.com/ && \
    pnpm config set network-concurrency 4 && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-mintimeout 20000 && \
    pnpm install --frozen-lockfile

# Copy source code
COPY core ./core
COPY web ./web

# Build web
RUN pnpm build:web

# ==========================================
FROM node:20-alpine AS prod-deps

WORKDIR /app
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY core/package.json ./core/
COPY web/package.json ./web/

# Install only runtime deps for core
RUN pnpm config set registry https://registry.npmmirror.com/ && \
    pnpm config set network-concurrency 4 && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-mintimeout 20000 && \
    pnpm -C core install --prod --frozen-lockfile

# ==========================================

FROM node:20-alpine AS runner

WORKDIR /app/core

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# Copy runtime deps
COPY --from=prod-deps /app/node_modules ../node_modules/
COPY --from=prod-deps /app/core/node_modules ./node_modules/
COPY --from=prod-deps /app/package.json ../package.json

# Copy core source
COPY --from=builder /app/core ./

# Copy built web assets
COPY --from=builder /app/web/dist ../web/dist

# Expose port
EXPOSE 8808

# Start command
CMD ["node", "client.js"]
