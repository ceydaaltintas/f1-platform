FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci && chmod -R 755 node_modules/.bin
COPY . .
RUN node node_modules/vite/bin/vite.js build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
