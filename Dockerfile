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

WORKDIR /app

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy installed dependencies and application code from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js .
COPY --from=builder /app/logger.js .
COPY --from=builder /app/swagger.js .
COPY --from=builder /app/package.json .

# Change ownership of all files to the appuser
RUN chown -R appuser:appgroup /app

# Switch to the non-root user
USER appuser

# Expose the port the app runs on
EXPOSE 3000

# The command to run the application
CMD [ "node", "server.js" ] 