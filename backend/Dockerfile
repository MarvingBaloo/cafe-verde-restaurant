FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer cache optimisation)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source after deps to avoid invalidating the npm layer on code changes
COPY . .

# Cloud Run injects PORT (default 8080); EXPOSE is documentation only
EXPOSE 8080

CMD ["node", "server.js"]
