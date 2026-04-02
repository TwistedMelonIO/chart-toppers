FROM node:20-alpine

LABEL org.opencontainers.image.version="3.5.0" \
      org.opencontainers.image.title="Chart Toppers" \
      org.opencontainers.image.description="QLab Scoring System"

# Add Python for license validation
RUN apk add --no-cache python3 py3-cryptography

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY public/ ./public/
COPY data/packs/ ./packs/

# License validation files (public key only — private key must NEVER be here)
COPY license_validator_simple.py ./
COPY machine_id_simple.py ./
COPY license_public_key.pem ./

EXPOSE 3000
EXPOSE 53535/udp

CMD ["node", "src/server.js"]
