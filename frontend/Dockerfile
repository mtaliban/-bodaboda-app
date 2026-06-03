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

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
