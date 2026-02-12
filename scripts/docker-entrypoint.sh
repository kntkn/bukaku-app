#!/bin/sh
set -e

# CREDENTIALS_JSON_B64 (base64) または CREDENTIALS_JSON (生JSON) から credentials.json を生成
if [ -n "$CREDENTIALS_JSON_B64" ]; then
  echo "$CREDENTIALS_JSON_B64" | base64 -d > /app/data/credentials.json
  echo "[entrypoint] credentials.json をbase64環境変数から生成しました"
elif [ -n "$CREDENTIALS_JSON" ]; then
  printf '%s\n' "$CREDENTIALS_JSON" > /app/data/credentials.json
  echo "[entrypoint] credentials.json を環境変数から生成しました"
else
  if [ ! -f /app/data/credentials.json ]; then
    echo "[entrypoint] WARNING: credentials.json が見つかりません。CREDENTIALS_JSON_B64 環境変数を設定してください。"
  fi
fi

exec "$@"
