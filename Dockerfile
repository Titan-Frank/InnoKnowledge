# ---- Stage 1: Build ----
FROM node:20-bookworm AS builder

WORKDIR /build

# Use China npm mirror
RUN npm config set registry https://registry.npmmirror.com

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
COPY packages/types/package.json packages/types/
COPY packages/server/package.json packages/server/
COPY packages/viewer/package.json packages/viewer/
RUN npm install

# Copy source
COPY packages/types/ packages/types/
COPY packages/server/ packages/server/
COPY packages/viewer/ packages/viewer/
COPY tsconfig.base.json ./

# Build (types has no build script — consumed as TS source via workspace link)
RUN npm run build -w packages/server \
 && npm run build -w packages/viewer

# Prune devDependencies for production (keeps workspace links intact)
RUN npm prune --omit=dev

# ---- Stage 2: Runtime ----
FROM pgvector/pgvector:pg16

# Use China apt mirrors
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.list 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list 2>/dev/null; \
    true

# Install Node.js 20 runtime via NodeSource
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# App directory — preserve workspace layout so node_modules symlinks resolve
WORKDIR /app

# Copy entire workspace (built + pruned)
COPY --from=builder /build/packages/types/ ./packages/types/
COPY --from=builder /build/packages/server/ ./packages/server/
COPY --from=builder /build/packages/viewer/dist/ ./packages/viewer/dist/
COPY --from=builder /build/node_modules/ ./node_modules/

# Copy data files for viewer (mkdir -p so missing dirs don't break build)
RUN mkdir -p ./data/frameworks ./data/patterns ./data/outlines
COPY data/frameworks/ ./data/frameworks/
COPY data/patterns/ ./data/patterns/
COPY data/outlines/ ./data/outlines/

# Copy schema SQL
COPY schemas/pg/knowledge_store.sql ./schema.sql

# Copy entrypoint
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Environment
ENV DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
ENV OKM_DATA_DIR=/app/data
ENV OKM_VIEWER_DIST=/app/packages/viewer/dist
ENV NODE_ENV=production

# PG data volume
VOLUME /var/lib/postgresql/data

EXPOSE 8765

ENTRYPOINT ["./entrypoint.sh"]
