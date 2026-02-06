FROM node:18-bullseye-slim

# Use Debian slim to provide stable native build toolchain for canvas/sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    libpixman-1-dev \
    libfreetype6-dev \
    pkg-config \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files first
COPY package*.json ./

# Copy the rest of the source (needed for postinstall baseline generation)
COPY . .

# Install production dependencies
RUN npm ci --only=production

# Create writable directories and set ownership for non-root runtime
RUN mkdir -p data logs uploads \
    file-protection/config \
    file-protection/backups \
    file-protection/logs \
 && chown -R node:node /usr/src/app

# Make scripts executable
RUN chmod +x startup.sh scripts/validate-env.sh

# Run as non-root for least privilege
USER node

# Expose ports for dashboard (3001) and Darklock platform (3002)
EXPOSE 3001 3002

# Start the application (baseline generation happens at runtime)
CMD ["sh", "startup.sh"]