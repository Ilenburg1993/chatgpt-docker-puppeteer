# =============================================================================
# Optimized Multi-stage Dockerfile for chatgpt-docker-puppeteer
# Uses remote Chrome via debugging protocol (host.docker.internal:9222)
# Base: Alpine for 30-40% size reduction vs Debian slim
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies (Build Cache Optimized)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Install production dependencies
# Cache layer invalidates only when package files change
COPY package.json package-lock.json ./

RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Production Image (Alpine-based)
# -----------------------------------------------------------------------------
FROM node:20-alpine

# Install runtime dependencies
# Combined into single layer to reduce image size
RUN apk add --no-cache \
    ca-certificates \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Configure environment for remote Chrome debugging
# Puppeteer skips Chromium download (connects to remote Chrome)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production \
    TZ=UTC \
    CHROME_REMOTE_DEBUGGING_PORT=9222

# Copy dependencies from build stage
# Placed early for better cache utilization
COPY --from=deps /app/node_modules ./node_modules

# Copy application files (ordered by change frequency)
# Config files change less frequently than source code
COPY package.json ./
COPY ecosystem.config.js ./
COPY config.json dynamic_rules.json ./

# Copy application directories
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY src/ ./src/

# Create necessary directories with proper permissions
# Single RUN command to reduce layers
RUN mkdir -p fila respostas logs profile && \
    chown -R node:node /app && \
    chmod +x scripts/healthcheck.js

# Switch to non-root user for security
USER node

# Configure volumes for data persistence
VOLUME ["/app/fila", "/app/respostas", "/app/logs", "/app/profile"]

# Expose dashboard port
EXPOSE 3008

# Optimized health check using dedicated script
# Faster startup and better error handling than inline node -e
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node scripts/healthcheck.js

# Use dumb-init to handle signals properly and reap zombie processes
# PM2 runtime runs both agente-gpt and dashboard-web from ecosystem.config.js
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.js"]
