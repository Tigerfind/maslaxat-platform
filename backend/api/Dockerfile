FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

EXPOSE 3001

# Папка под загрузки. В проде поверх /data монтируется persistent volume Railway;
# контейнер работает как root, чтобы иметь права на запись в этот том
# (том монтируется с владельцем root). UPLOAD_DIR=/data/uploads в env сервиса.
RUN mkdir -p /data/uploads

CMD ["node", "src/server.js"]
