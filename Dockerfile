# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Final stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Create uploads directory
RUN mkdir -p /app/uploads

# Copy dependencies from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Expose port (Railway sets PORT env var)
EXPOSE 8080

# Set NODE_ENV
ENV NODE_ENV=production

# Start server
CMD ["node", "server.js"]
