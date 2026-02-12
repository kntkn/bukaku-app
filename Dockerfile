# 軽量ベースイメージ + Chromiumインストール（~750MB vs 2.8GB）
FROM node:20-bookworm-slim

WORKDIR /app

# Chromiumの依存ライブラリ + 日本語フォント
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-ipafont-gothic fonts-noto-cjk \
    curl \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# 依存関係インストール
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Playwright Chromiumのみインストール（Firefoxなどは不要）
RUN npx playwright install chromium

# ソースコードコピー
COPY server/ ./server/
COPY skills/ ./skills/
COPY data/ ./data/
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/health || exit 1

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
