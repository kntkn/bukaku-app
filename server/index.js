/**
 * 物確バックエンドサーバー
 * WebSocket対応版 - リアルタイムプレビュー機能付き
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// HTTPサーバーを作成（WebSocketと共有）
const server = http.createServer(app);

// WebSocketサーバーを作成
const wss = new WebSocketServer({ server });

// アクティブなセッションを管理
const sessions = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: '物確バックエンド',
    version: '2.0.0',
    websocket: true
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// 物確セッション開始（WebSocket用のセッションIDを返す）
app.post('/api/bukaku/start', (req, res) => {
  const { propertyName, checkAD, platform = 'itandi' } = req.body;

  if (!propertyName) {
    return res.status(400).json({
      success: false,
      error: '物件名が必要です'
    });
  }

  // セッションIDを生成
  const sessionId = uuidv4();

  // セッション情報を保存
  sessions.set(sessionId, {
    propertyName,
    checkAD,
    platform,
    status: 'pending',
    createdAt: new Date()
  });

  console.log(`[物確] セッション作成: ${sessionId} - ${propertyName}`);

  res.json({
    success: true,
    sessionId,
    message: 'WebSocketに接続して物確を開始してください'
  });
});

// WebSocket接続処理
wss.on('connection', (ws) => {
  console.log('[WebSocket] クライアント接続');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start_bukaku') {
        const { sessionId } = data;
        const session = sessions.get(sessionId);

        if (!session) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'セッションが見つかりません'
          }));
          return;
        }

        // 物確を実行
        await executeBukaku(ws, session, sessionId);
      }
    } catch (error) {
      console.error('[WebSocket] メッセージ処理エラー:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] クライアント切断');
  });
});

/**
 * 物確を実行（スクリーンショットをストリーミング）
 */
async function executeBukaku(ws, session, sessionId) {
  const { chromium } = require('playwright');
  const yaml = require('yaml');
  const fs = require('fs');
  const path = require('path');

  // スキル定義を読み込み
  const skillPath = path.join(__dirname, '../skills/itandi.yaml');
  const skill = yaml.parse(fs.readFileSync(skillPath, 'utf-8'));

  const CREDENTIALS = {
    email: process.env.ITANDI_EMAIL || 'info@fun-t.jp',
    password: process.env.ITANDI_PASSWORD || 'funt0406'
  };

  // ステータス送信ヘルパー
  const sendStatus = (status, message) => {
    ws.send(JSON.stringify({ type: 'status', status, message }));
  };

  // スクリーンショット送信ヘルパー
  const sendScreenshot = async (page) => {
    try {
      const buffer = await page.screenshot({ type: 'jpeg', quality: 50 });
      const base64 = buffer.toString('base64');
      ws.send(JSON.stringify({
        type: 'screenshot',
        image: `data:image/jpeg;base64,${base64}`
      }));
    } catch (e) {
      // スクリーンショット取得失敗は無視
    }
  };

  console.log(`[物確] 実行開始: ${session.propertyName}`);
  sendStatus('starting', '物確を開始します...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  // 定期的にスクリーンショットを送信
  const screenshotInterval = setInterval(() => sendScreenshot(page), 500);

  try {
    // ログイン
    sendStatus('logging_in', 'ITANDIにログイン中...');
    await page.goto(skill.login.url, { waitUntil: 'networkidle' });
    await sendScreenshot(page);

    // 2回ログイン試行
    for (let i = 0; i < 2; i++) {
      if (page.url().includes('itandibb.com') && !page.url().includes('login')) {
        break;
      }
      const emailInput = await page.$(skill.login.selectors.email_input);
      if (emailInput) {
        await emailInput.fill(CREDENTIALS.email);
        await page.fill(skill.login.selectors.password_input, CREDENTIALS.password);
        await page.click(skill.login.selectors.submit_button);
        await page.waitForTimeout(3000);
      }
    }

    if (!page.url().includes('itandibb.com')) {
      throw new Error('ログインに失敗しました');
    }

    sendStatus('logged_in', 'ログイン成功');
    await sendScreenshot(page);

    // 検索ページへ移動
    sendStatus('navigating', '検索ページへ移動中...');
    const listSearchButtons = await page.$$('text=リスト検索');
    if (listSearchButtons.length > 0) {
      await listSearchButtons[0].click();
      await page.waitForTimeout(2000);
    }
    await sendScreenshot(page);

    // 物件名で検索
    sendStatus('searching', `「${session.propertyName}」を検索中...`);

    const buildingNameInput = await page.$(skill.search.form.building_name.selector);
    if (buildingNameInput) {
      await buildingNameInput.fill(session.propertyName);
      await page.waitForTimeout(500);
    }

    // 検索ボタンの状態確認
    const searchButton = await page.$(skill.search.submit_button);
    if (searchButton) {
      const isDisabled = await searchButton.isDisabled();
      if (isDisabled) {
        // 所在地を設定
        sendStatus('setting_location', '検索条件を設定中...');
        await page.click(skill.search.location_filter.open_button);
        await page.waitForTimeout(500);
        await page.click('text=関東');
        await page.waitForTimeout(200);
        await page.click('text=東京都');
        await page.waitForTimeout(300);
        await page.click(skill.search.location_filter.confirm_button);
        await page.waitForTimeout(1000);
        await sendScreenshot(page);
      }

      await searchButton.click();
      await page.waitForTimeout(5000);
    }

    sendStatus('analyzing', '検索結果を解析中...');
    await sendScreenshot(page);

    // 結果を抽出
    const results = [];
    const cardSelector = skill.result.property_card.selector;
    const cards = await page.$$(cardSelector).catch(() => []);

    for (let i = 0; i < Math.min(cards.length, 10); i++) {
      const card = cards[i];
      const cardText = await card.textContent();

      if (session.propertyName && !cardText.includes(session.propertyName)) {
        continue;
      }

      const propertyInfo = {
        raw_text: cardText.substring(0, 300),
        status: 'unknown',
        has_ad: false,
        viewing_available: false
      };

      if (cardText.includes('募集中')) {
        propertyInfo.status = 'available';
      } else if (cardText.includes('申込あり') || cardText.includes('商談中')) {
        propertyInfo.status = 'applied';
      } else if (cardText.includes('成約済') || cardText.includes('募集終了')) {
        propertyInfo.status = 'unavailable';
      }

      if (cardText.includes('広告費') || cardText.includes('AD')) {
        propertyInfo.has_ad = true;
      }

      if (cardText.includes('内見可') || cardText.includes('即内見')) {
        propertyInfo.viewing_available = true;
      }

      results.push(propertyInfo);
    }

    // ADフィルタ
    let filteredResults = results;
    if (session.checkAD) {
      filteredResults = results.filter(r => r.has_ad);
    }

    // 完了
    sendStatus('completed', '物確完了');
    await sendScreenshot(page);

    ws.send(JSON.stringify({
      type: 'result',
      success: true,
      property_name: session.propertyName,
      platform: 'itandi',
      results: filteredResults
    }));

    // セッションを更新
    sessions.set(sessionId, { ...session, status: 'completed' });

  } catch (error) {
    console.error('[物確] エラー:', error);
    sendStatus('error', `エラー: ${error.message}`);
    ws.send(JSON.stringify({
      type: 'result',
      success: false,
      error: error.message
    }));
  } finally {
    clearInterval(screenshotInterval);
    await browser.close();
  }
}

// 対応プラットフォーム一覧
app.get('/api/platforms', (req, res) => {
  res.json({
    platforms: [
      { id: 'itandi', name: 'ITANDI BB', status: 'active' },
      { id: 'ierabu', name: 'いえらぶ', status: 'planned' }
    ]
  });
});

// サーバー起動
server.listen(PORT, () => {
  console.log(`物確バックエンドサーバー起動: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
});
