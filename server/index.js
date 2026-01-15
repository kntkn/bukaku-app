/**
 * 物確バックエンドサーバー
 * WebSocket対応版 - リアルタイムプレビュー機能付き
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@notionhq/client');

const app = express();

// ファイルアップロード設定（メモリストレージ）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB制限
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('PDFファイルのみアップロード可能です'));
    }
  }
});
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

/**
 * PDFマイソク解析エンドポイント
 */
app.post('/api/maisoku/parse', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'PDFファイルが必要です'
      });
    }

    console.log('[マイソク解析] ファイル受信:', req.file.originalname);

    // PDFからテキストを抽出
    const pdfData = await pdfParse(req.file.buffer);
    const extractedText = pdfData.text;

    console.log('[マイソク解析] テキスト抽出完了, 文字数:', extractedText.length);

    // Claude APIでマイソクを解析
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const prompt = `以下は不動産のマイソク（物件資料）から抽出したテキストです。この情報から物件情報を構造化して抽出してください。

抽出するフィールド:
- property_name: 物件名（建物名）
- address: 住所
- rent: 賃料
- management_fee: 管理費・共益費
- deposit: 敷金
- key_money: 礼金
- floor_plan: 間取り
- area: 専有面積
- building_type: 構造（RC、鉄骨など）
- floors: 階数
- built_year: 築年月
- management_company: 管理会社名
- contact_phone: 連絡先電話番号

JSONフォーマットで出力してください。不明な項目はnullとしてください。

マイソクテキスト:
${extractedText.substring(0, 8000)}`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    // レスポンスからJSONを抽出
    const responseText = message.content[0].text;
    let parsedData;

    try {
      // JSON部分を抽出（```json ... ``` または直接のJSON）
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) ||
        responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        throw new Error('JSON形式のレスポンスが見つかりません');
      }
    } catch (e) {
      console.error('[マイソク解析] JSON解析エラー:', e);
      parsedData = { raw_response: responseText };
    }

    console.log('[マイソク解析] 解析完了:', parsedData.property_name || '物件名不明');

    res.json({
      success: true,
      data: parsedData,
      raw_text_length: extractedText.length
    });

  } catch (error) {
    console.error('[マイソク解析] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Notion連携 - 物確結果を記録
 */
app.post('/api/notion/record', async (req, res) => {
  try {
    const { propertyName, results, platform, parsedData } = req.body;

    if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
      return res.status(400).json({
        success: false,
        error: 'Notion設定が必要です（NOTION_TOKEN, NOTION_DATABASE_ID）'
      });
    }

    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const databaseId = process.env.NOTION_DATABASE_ID;

    console.log('[Notion] 物確結果を記録:', propertyName);

    // 結果をまとめて1つのページとして記録
    const properties = {
      '物件名': {
        title: [{ text: { content: propertyName || '不明' } }]
      },
      'プラットフォーム': {
        select: { name: platform?.toUpperCase() || 'ITANDI' }
      },
      '確認日時': {
        date: { start: new Date().toISOString() }
      },
      '結果件数': {
        number: results?.length || 0
      }
    };

    // 最初の結果からステータスを取得
    if (results && results.length > 0) {
      const firstResult = results[0];

      properties['ステータス'] = {
        select: {
          name: firstResult.status === 'available' ? '募集中' :
            firstResult.status === 'applied' ? '申込あり' : '確認不可'
        }
      };

      properties['AD有り'] = {
        checkbox: firstResult.has_ad || false
      };

      properties['内見可'] = {
        checkbox: firstResult.viewing_available || false
      };
    }

    // マイソクデータがあれば追加
    if (parsedData) {
      if (parsedData.address) {
        properties['住所'] = {
          rich_text: [{ text: { content: parsedData.address } }]
        };
      }
      if (parsedData.rent) {
        properties['賃料'] = {
          rich_text: [{ text: { content: parsedData.rent } }]
        };
      }
      if (parsedData.management_company) {
        properties['管理会社'] = {
          rich_text: [{ text: { content: parsedData.management_company } }]
        };
      }
    }

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties
    });

    console.log('[Notion] 記録完了:', response.id);

    res.json({
      success: true,
      pageId: response.id,
      url: response.url
    });

  } catch (error) {
    console.error('[Notion] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Notionデータベース初期化（プロパティの設定）
 */
app.post('/api/notion/setup', async (req, res) => {
  try {
    if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
      return res.status(400).json({
        success: false,
        error: 'Notion設定が必要です'
      });
    }

    const notion = new Client({ auth: process.env.NOTION_TOKEN });
    const databaseId = process.env.NOTION_DATABASE_ID;

    // データベースのプロパティを更新
    await notion.databases.update({
      database_id: databaseId,
      properties: {
        '物件名': { title: {} },
        'ステータス': {
          select: {
            options: [
              { name: '募集中', color: 'green' },
              { name: '申込あり', color: 'yellow' },
              { name: '確認不可', color: 'red' }
            ]
          }
        },
        'プラットフォーム': {
          select: {
            options: [
              { name: 'ITANDI', color: 'blue' },
              { name: 'いえらぶ', color: 'purple' }
            ]
          }
        },
        'AD有り': { checkbox: {} },
        '内見可': { checkbox: {} },
        '確認日時': { date: {} },
        '結果件数': { number: {} },
        '住所': { rich_text: {} },
        '賃料': { rich_text: {} },
        '管理会社': { rich_text: {} }
      }
    });

    res.json({
      success: true,
      message: 'データベースを設定しました'
    });

  } catch (error) {
    console.error('[Notion Setup] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// サーバー起動
server.listen(PORT, () => {
  console.log(`物確バックエンドサーバー起動: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
});
