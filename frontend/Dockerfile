FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

ARG VITE_DRIVER_SERVICE_URL
ENV VITE_DRIVER_SERVICE_URL=$VITE_DRIVER_SERVICE_URL

ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine

# Generate a self-signed TLS certificate so the app runs on HTTPS.
# WebRTC (getUserMedia) requires a secure context — HTTPS or localhost.
RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/certs && \
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nginx/certs/key.pem \
      -out  /etc/nginx/certs/cert.pem \
      -subj "/CN=bodaboda/O=BodaBoda/C=TZ" && \
    apk del openssl

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
