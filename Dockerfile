FROM node:22-alpine

# Docker CLI so scripts can control the host Docker daemon
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY server.js .
COPY scripts ./scripts

RUN chmod +x /app/scripts/*.sh

USER node

EXPOSE 3002

CMD ["node", "server.js"]