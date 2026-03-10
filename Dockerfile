# Use Node.js LTS
FROM node:18-alpine

# Add tini for better signal handling
RUN apk add --no-cache tini

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Ensure port 8080 is available
EXPOSE 8080

# Use tini as entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Start the app
CMD ["node", "app.js"]
