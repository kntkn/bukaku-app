# 物確アプリ (bukaku-app) — プロジェクト固有ルール

## パイプライン注意点

### itandi
- トップページに戻されたら上部ログインボタンから進む（retryLogin）

### essquare
- Auth0セッション有効時はfill/clickをoptionalでスキップ

### browser-pool
- successCheck.elementExistsでページ要素も見てログイン判定

## 詳細情報
- Memory参照: `~/.claude/projects/-Users-kentohonda/memory/bukaku-app.md`
