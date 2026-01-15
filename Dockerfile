# Playwright用のDockerイメージ
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm ci --omit=dev

# ソースコードをコピー
COPY server/ ./server/
COPY src/ ./src/
COPY skills/ ./skills/

# ポート設定
ENV PORT=3001
EXPOSE 3001

# サーバー起動
CMD ["node", "server/index.js"]
