FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/cnij.sqlite UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups TZ=America/Campo_Grande
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
