# bukaku-app

物確（空室確認）自動化Webアプリ。マイソクPDFをアップロードすると、AIが物件情報を解析し、各不動産プラットフォームで自動的に空室確認を行う。

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + React 19 + Tailwind CSS 4
- **Backend**: Express 5 + WebSocket
- **Browser Automation**: Playwright (Chromium)
- **AI**: Anthropic Claude API (PDF解析)
- **Data**: Notion API

## Prerequisites

- Node.js 20+
- Anthropic API Key
- Notion API Token + Database ID

## Setup

```bash
# Clone
git clone https://github.com/kntkn/bukaku-app.git
cd bukaku-app

# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Configure environment variables
cp .env.example .env
# Edit .env and fill in your API keys
```

### Environment Variables

`.env.example` を `.env` にコピーして、以下を設定:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key (マイソク解析用) |
| `NOTION_TOKEN` | Yes | Notion API token |
| `NOTION_DATABASE_ID` | Yes | 物確結果DB の ID |
| `NOTION_MAPPING_DATABASE_ID` | Yes | マッピングDB の ID |
| `ADMIN_EMAIL` | Yes | ログイン用メールアドレス |
| `ADMIN_PASSWORD` | Yes | ログイン用パスワード |
| `PORT` | No | Backend port (default: 3001) |
| `NEXT_PUBLIC_BACKEND_URL` | No | Backend URL (default: `http://localhost:3001`) |

## Run (Local Development)

フロントエンドとバックエンドを **2つのターミナル** で起動する:

```bash
# Terminal 1 - Backend (Express + WebSocket)
npm run server

# Terminal 2 - Frontend (Next.js dev server)
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
