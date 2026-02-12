#!/bin/sh
set -e

# CREDENTIALS_JSON 環境変数からcredentials.jsonを生成
if [ -n "$CREDENTIALS_JSON" ]; then
  printf '%s\n' "$CREDENTIALS_JSON" > /app/data/credentials.json
  echo "[entrypoint] credentials.json を環境変数から生成しました"
else
  if [ ! -f /app/data/credentials.json ]; then
    echo "[entrypoint] WARNING: credentials.json が見つかりません。CREDENTIALS_JSON 環境変数を設定してください。"
  fi
fi

exec "$@"
