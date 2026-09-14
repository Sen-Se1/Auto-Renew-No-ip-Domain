FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY server.js .

USER node

EXPOSE 3002

CMD ["node", "server.js"]