# Playwright用のDockerイメージ（Chromium同梱）
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ソースコードをコピー
COPY server/ ./server/
COPY src/ ./src/
COPY skills/ ./skills/
COPY data/ ./data/
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

# entrypointスクリプトに実行権限付与
RUN chmod +x ./scripts/docker-entrypoint.sh

# ポート設定
ENV PORT=3001
EXPOSE 3001

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# entrypointでcredentials.jsonを環境変数から生成してから起動
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
