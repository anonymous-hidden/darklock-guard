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

# Create data directory for SQLite
RUN mkdir -p data

# Make startup script executable
RUN chmod +x startup.sh

# Expose the platform expected open port (Render service uses port 10000)
EXPOSE 10000

# Start the application (baseline generation happens at runtime)
CMD ["./startup.sh"]