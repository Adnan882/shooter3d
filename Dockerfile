# build the Vite client, then ship all TS workspaces + built client in one image
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared ./shared
COPY client ./client
COPY server ./server
RUN npm ci
RUN npm run build:client

FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared ./shared
COPY client ./client
COPY server ./server
RUN npm ci
COPY --from=builder /app/client/dist ./client/dist
EXPOSE 8080
CMD ["npm", "run", "start", "-w", "server"]