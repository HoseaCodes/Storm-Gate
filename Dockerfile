# Use the official Node.js 18 LTS image as base (more recent and stable)
FROM node:18-alpine

# Set working directory within the container
WORKDIR /app

# Install build dependencies for native modules (like jpegtran-bin)
RUN apk add --no-cache \
    gcc \
    g++ \
    make \
    python3 \
    autoconf \
    automake \
    libtool \
    nasm \
    libpng-dev \
    libjpeg-turbo-dev

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Change ownership of the app directory to the nodejs user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Expose the port the app runs on (Fly.io uses 8080 internally)
EXPOSE 8080

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Command to run the application
CMD ["node", "src/server.js"]

