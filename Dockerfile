FROM node:22-alpine

# Runtime tools
RUN apk add --no-cache \
    docker-cli \
    curl

WORKDIR /app

# Install Node dependencies
COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

# Application
COPY server.js .
COPY scripts ./scripts

RUN chmod +x /app/scripts/*.sh

EXPOSE 3002

CMD ["node", "server.js"]