FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /data && chown app:app /data
USER app

EXPOSE 4100
CMD ["node", "src/server.js"]
