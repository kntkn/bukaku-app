# 軽量ベースイメージ + Chromiumインストール（~750MB vs 2.8GB）
FROM node:20-bookworm-slim

WORKDIR /app

# 日本語フォント + curl（Chromium依存は playwright install --with-deps で自動追加）
RUN apt-get update && apt-get install -y \
    fonts-ipafont-gothic fonts-noto-cjk \
    curl \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# 依存関係インストール
COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Playwright Chromiumのみインストール（--with-depsでOS依存ライブラリも自動追加）
RUN npx playwright install --with-deps chromium

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
