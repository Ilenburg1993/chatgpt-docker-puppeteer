# =============================================================================
# Multi-stage Dockerfile for chatgpt-docker-puppeteer
# Uses remote Chrome via debugging protocol (host.docker.internal:9222)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:25-slim AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts

# -----------------------------------------------------------------------------
# Stage 2: Production Image
# -----------------------------------------------------------------------------
FROM node:25-slim

# Install only essential tools (no Chrome/Chromium - uses remote debugging)
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Configure to use remote Chrome via debugging protocol
# Default: host.docker.internal:9222 (Docker Desktop Windows/Mac)
# Override with CHROME_WS_ENDPOINT environment variable
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production \
    TZ=UTC \
    CHROME_REMOTE_DEBUGGING_PORT=9222

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application files
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY index.js ecosystem.config.js ./
COPY config.json dynamic_rules.json ./

# Create necessary directories with proper permissions
RUN mkdir -p fila respostas logs profile && \
    chown -R node:node /app

# Switch to non-root user for security
USER node

# Configure volumes for data persistence
VOLUME ["/app/fila", "/app/respostas", "/app/logs", "/app/profile"]

# Expose dashboard port
EXPOSE 3008

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3008/api/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))" || exit 1

# Start application
CMD ["node", "index.js"]