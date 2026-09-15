FROM node:22-alpine

RUN apk add --no-cache \
    docker-cli \
    python3 \
    make \
    curl
    g++

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY server.js .
COPY scripts ./scripts

RUN chmod +x /app/scripts/*.sh

EXPOSE 3002

CMD ["node", "server.js"]