# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application source code
COPY . .

# ---

# Stage 2: Production stage
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Copy installed dependencies from the builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application code from the builder stage
# Note: We copy public, server.js etc. but not the whole folder again
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js .
COPY --from=builder /app/logger.js .
COPY --from=builder /app/swagger.js .

# Expose the port the app runs on
EXPOSE 3000

# The command to run the application
# We use node directly, as Kubernetes will handle restarts
CMD [ "node", "server.js" ] 