/**
 * 物確バックエンドサーバー
 * WebSocket対応版 - リアルタイムプレビュー機能付き
 */

// 環境変数を読み込み
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@notionhq/client');

// 並列検索・学習機能モジュール
const { parallelSearch, searchOnPlatform } = require('./engine/parallel-searcher');
const { getSearchStrategy, learnMapping, getStats } = require('./engine/company-mapper');

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

      // 並列検索（4ブラウザ同時、リアルタイムスクリーンショット）
      if (data.type === 'start_parallel') {
        const { propertyName, managementCompany, checkAD, platforms } = data;

        if (!propertyName) {
          ws.send(JSON.stringify({
            type: 'error',
            message: '物件名が必要です'
          }));
          return;
        }

        // 並列検索を実行
        await executeParallelBukaku(ws, {
          propertyName,
          managementCompany,
          checkAD,
          platforms: platforms || []
        });
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

/**
 * 並列物確を実行（4ブラウザ同時、リアルタイムスクリーンショット）
 */
async function executeParallelBukaku(ws, options) {
  const { chromium } = require('playwright');
  const fs = require('fs');
  const path = require('path');

  const { propertyName, managementCompany, checkAD, platforms } = options;

  // 認証情報を読み込み
  const credentialsPath = path.join(__dirname, '../data/credentials.json');
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

  // 使用するプラットフォーム（最大4つずつ処理）
  const platformsToSearch = platforms.length > 0 ? platforms : credentials.priority;
  const batchSize = 4;

  console.log(`[並列物確] 開始: ${propertyName}, プラットフォーム: ${platformsToSearch.join(', ')}`);

  const sendStatus = (message) => {
    ws.send(JSON.stringify({ type: 'status', status: 'searching', message }));
  };

  // 複数スクリーンショット送信（位置情報付き）
  const sendScreenshots = async (browsers) => {
    try {
      const screenshots = await Promise.all(
        browsers.map(async (b, idx) => {
          if (!b.page) return null;
          try {
            const buffer = await b.page.screenshot({ type: 'jpeg', quality: 40 });
            return {
              position: idx,
              platformId: b.platformId,
              image: `data:image/jpeg;base64,${buffer.toString('base64')}`
            };
          } catch (e) {
            return null;
          }
        })
      );

      const validScreenshots = screenshots.filter(s => s !== null);
      if (validScreenshots.length > 0) {
        ws.send(JSON.stringify({
          type: 'screenshots',  // 複数形
          images: validScreenshots
        }));
      }
    } catch (e) {
      // 無視
    }
  };

  const allResults = [];
  const allErrors = [];

  // バッチ処理（4つずつ）
  for (let i = 0; i < platformsToSearch.length; i += batchSize) {
    const batch = platformsToSearch.slice(i, i + batchSize);
    sendStatus(`バッチ ${Math.floor(i / batchSize) + 1}: ${batch.join(', ')} を検索中...`);

    // 4ブラウザを同時起動
    const browsers = await Promise.all(
      batch.map(async (platformId, idx) => {
        const platform = credentials.platforms[platformId];
        if (!platform) return { platformId, browser: null, page: null, error: 'Unknown platform' };

        try {
          const browser = await chromium.launch({
            headless: false,
            args: [
              `--window-position=${(idx % 2) * 640},${Math.floor(idx / 2) * 400 + 25}`,
              '--window-size=640,400'
            ]
          });
          const context = await browser.newContext({ viewport: { width: 620, height: 350 } });
          const page = await context.newPage();

          return { platformId, platform, browser, page, context };
        } catch (e) {
          return { platformId, browser: null, page: null, error: e.message };
        }
      })
    );

    // スクリーンショット定期送信
    const screenshotInterval = setInterval(() => sendScreenshots(browsers), 500);

    try {
      // 各ブラウザで検索実行
      const results = await Promise.all(
        browsers.map(async (b) => {
          if (!b.browser) return { platformId: b.platformId, success: false, error: b.error };

          try {
            // ログイン
            sendStatus(`${b.platform.name} にログイン中...`);
            await b.page.goto(b.platform.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await b.page.waitForTimeout(2000);

            // プラットフォーム別ログイン処理
            const loginSuccess = await performPlatformLogin(b.page, b.platformId, b.platform);
            if (!loginSuccess) {
              return { platformId: b.platformId, success: false, error: 'ログイン失敗' };
            }

            // 検索
            sendStatus(`${b.platform.name} で「${propertyName}」を検索中...`);
            const searchResults = await performPlatformSearch(b.page, b.platformId, propertyName);

            return {
              platformId: b.platformId,
              platformName: b.platform.name,
              success: true,
              results: searchResults
            };
          } catch (e) {
            return { platformId: b.platformId, success: false, error: e.message };
          }
        })
      );

      // 結果を集計
      for (const r of results) {
        if (r.success && r.results?.length > 0) {
          allResults.push(r);
          // ヒットしたら学習
          if (managementCompany) {
            learnMapping(managementCompany, r.platformId);
          }
        } else if (!r.success) {
          allErrors.push(r);
        }
      }

    } finally {
      clearInterval(screenshotInterval);
      // ブラウザを閉じる
      for (const b of browsers) {
        if (b.browser) await b.browser.close().catch(() => {});
      }
    }

    // ヒットがあれば終了
    if (allResults.length > 0) {
      break;
    }
  }

  // ADフィルタリング
  let filteredResults = allResults;
  if (checkAD) {
    filteredResults = allResults.map(r => ({
      ...r,
      results: r.results.filter(item => item.has_ad)
    })).filter(r => r.results.length > 0);
  }

  // 結果送信
  sendStatus('検索完了');
  ws.send(JSON.stringify({
    type: 'result',
    success: true,
    property_name: propertyName,
    strategy: 'parallel',
    hits: filteredResults,
    errors: allErrors
  }));
}

/**
 * プラットフォーム別ログイン処理
 */
async function performPlatformLogin(page, platformId, platform) {
  const creds = platform.credentials;

  try {
    switch (platformId) {
      case 'itandi':
        await page.waitForSelector('input#email', { state: 'visible', timeout: 10000 });
        await page.fill('input#email', creds.email);
        await page.fill('input#password', creds.password);
        await page.click('input[type="submit"]');
        await page.waitForTimeout(3000);
        return !page.url().includes('login');

      case 'ierabu':
        await page.waitForSelector('input[placeholder="ログインIDを入力"]', { state: 'visible', timeout: 10000 });
        await page.fill('input[placeholder="ログインIDを入力"]', creds.email);
        await page.fill('input[placeholder="パスワードを入力"]', creds.password);
        await page.click('input#loginButton');
        await page.waitForTimeout(3000);
        return !page.url().includes('login');

      case 'atbb':
        await page.waitForSelector('input#loginFormText', { state: 'visible', timeout: 10000 });
        await page.fill('input#loginFormText', creds.id);
        await page.fill('input#passFormText', creds.password);
        await page.click('input#loginSubmit');
        await page.waitForTimeout(3000);
        return !page.url().includes('login');

      default:
        // 汎用ログイン
        const emailInput = await page.$('input[type="email"], input[name="email"], input#email, input#loginFormText');
        if (emailInput) {
          await emailInput.fill(creds.email || creds.id || '');
          const passInput = await page.$('input[type="password"], input[name="password"]');
          if (passInput) await passInput.fill(creds.password || '');
          const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
          if (submitBtn) await submitBtn.click();
          await page.waitForTimeout(3000);
        }
        return true;
    }
  } catch (e) {
    console.error(`[${platformId}] ログインエラー:`, e.message);
    return false;
  }
}

/**
 * プラットフォーム別検索処理
 */
async function performPlatformSearch(page, platformId, propertyName) {
  try {
    // 検索ボックスを探す
    const searchInput = await page.$('input[type="search"], input[name="keyword"], input[placeholder*="検索"], input[placeholder*="物件"]');
    if (searchInput) {
      await searchInput.fill(propertyName);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }

    // 結果をパース（簡易版）
    const results = await page.evaluate(() => {
      const items = [];
      // 一般的な物件カードを探す
      const cards = document.querySelectorAll('[class*="property"], [class*="item"], [class*="card"], tr');
      cards.forEach((card, idx) => {
        if (idx < 5) {  // 最大5件
          const text = card.innerText || '';
          if (text.length > 20) {
            items.push({
              status: text.includes('募集中') ? 'available' : text.includes('申込') ? 'applied' : 'unknown',
              has_ad: text.includes('AD') || text.includes('広告'),
              viewing_available: text.includes('内見可') || text.includes('即可'),
              raw_text: text.substring(0, 200)
            });
          }
        }
      });
      return items;
    });

    return results;
  } catch (e) {
    console.error(`[${platformId}] 検索エラー:`, e.message);
    return [];
  }
}

// 対応プラットフォーム一覧
app.get('/api/platforms', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const credentialsPath = path.join(__dirname, '../data/credentials.json');
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

  const platforms = Object.entries(credentials.platforms).map(([id, info]) => ({
    id,
    name: info.name,
    status: 'active'
  }));

  res.json({ platforms });
});

/**
 * 並列検索エンドポイント
 * 管理会社名があれば検索戦略を決定、なければ全プラットフォーム並列検索
 */
app.post('/api/bukaku/parallel', async (req, res) => {
  const { propertyName, managementCompany, checkAD, stopOnFirstHit = true } = req.body;

  if (!propertyName) {
    return res.status(400).json({
      success: false,
      error: '物件名が必要です'
    });
  }

  console.log(`[並列物確] 開始: ${propertyName}, 管理会社: ${managementCompany || '不明'}`);

  try {
    // 検索戦略を決定
    const strategy = getSearchStrategy(managementCompany);
    console.log(`[並列物確] 戦略: ${strategy.strategy}, プラットフォーム: ${strategy.platforms.join(', ')}`);

    // 並列検索を実行
    const searchResult = await parallelSearch(propertyName, {
      platforms: strategy.platforms,
      batchSize: 4,
      stopOnFirstHit,
      onStatus: (platformId, status, message) => {
        console.log(`[${platformId}] ${status}: ${message}`);
      }
    });

    // ADフィルタリング
    let filteredHits = searchResult.hits;
    if (checkAD) {
      filteredHits = searchResult.hits.map(hit => ({
        ...hit,
        results: hit.results.filter(r => r.has_ad)
      })).filter(hit => hit.results.length > 0);
    }

    res.json({
      success: true,
      property_name: propertyName,
      management_company: managementCompany,
      strategy: strategy.strategy,
      hits: filteredHits,
      misses: searchResult.misses,
      errors: searchResult.errors,
      stats: getStats()
    });

  } catch (error) {
    console.error('[並列物確] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 検索戦略確認エンドポイント
 * 管理会社名から検索戦略（単一/並列）を判定
 */
app.post('/api/bukaku/strategy', (req, res) => {
  const { managementCompany } = req.body;

  try {
    const strategy = getSearchStrategy(managementCompany);
    console.log(`[戦略確認] 管理会社: ${managementCompany || '不明'} → ${strategy.strategy} (${strategy.platforms.join(', ')})`);

    res.json({
      success: true,
      managementCompany: managementCompany || null,
      strategy: strategy.strategy,
      platforms: strategy.platforms,
      platformCount: strategy.platforms.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 学習機能エンドポイント
 * 物確結果から管理会社→プラットフォームの対応を学習
 */
app.post('/api/learn', (req, res) => {
  const { managementCompany, platformId } = req.body;

  if (!managementCompany || !platformId) {
    return res.status(400).json({
      success: false,
      error: '管理会社名とプラットフォームIDが必要です'
    });
  }

  try {
    learnMapping(managementCompany, platformId);
    const stats = getStats();

    res.json({
      success: true,
      message: `学習完了: ${managementCompany} → ${platformId}`,
      stats
    });
  } catch (error) {
    console.error('[学習] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 対応表統計エンドポイント
 */
app.get('/api/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
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
      model: 'claude-sonnet-4-20250514',
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
 * 管理会社とプラットフォームの組み合わせを学習
 */
app.post('/api/notion/record', async (req, res) => {
  try {
    const { propertyName, results, platform, parsedData, managementCompany } = req.body;

    // 管理会社とプラットフォームの組み合わせを学習
    const companyName = managementCompany || parsedData?.management_company;
    if (companyName && platform) {
      try {
        learnMapping(companyName, platform);
        console.log(`[学習] ${companyName} → ${platform}`);
      } catch (e) {
        console.error('[学習] エラー:', e.message);
      }
    }

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
    // プロパティ名はNotionの物確結果DBに合わせる
    const properties = {
      '物件名': {
        title: [{ text: { content: propertyName || '不明' } }]
      },
      'ヒットプラットフォーム': {
        rich_text: [{ text: { content: platform?.toUpperCase() || 'ITANDI' } }]
      },
      '確認日時': {
        date: { start: new Date().toISOString() }
      },
      '確認サイト数': {
        number: results?.length || 0
      }
    };

    // 最初の結果からステータスを取得
    if (results && results.length > 0) {
      const firstResult = results[0];

      // 空室状況: 空室あり, 満室, 不明, 要電話確認
      properties['空室状況'] = {
        select: {
          name: firstResult.status === 'available' ? '空室あり' :
            firstResult.status === 'applied' ? '要電話確認' : '不明'
        }
      };

      properties['AD有無'] = {
        checkbox: firstResult.has_ad || false
      };

      properties['内見可否'] = {
        checkbox: firstResult.viewing_available || false
      };
    }

    // マイソクデータがあれば追加（配列の場合は最初の要素を使用）
    const maisokuData = Array.isArray(parsedData) ? parsedData[0] : parsedData;
    if (maisokuData) {
      if (maisokuData.address) {
        properties['住所'] = {
          rich_text: [{ text: { content: maisokuData.address } }]
        };
      }
      if (maisokuData.rent) {
        // 賃料から数字を抽出（例: "90,000円" → 90000）
        const rentNumber = parseInt(maisokuData.rent.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(rentNumber)) {
          properties['賓料'] = {
            number: rentNumber
          };
        }
      }
      if (maisokuData.management_company) {
        properties['管理会社'] = {
          rich_text: [{ text: { content: maisokuData.management_company } }]
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

/**
 * 管理会社DB - 一覧取得
 */
app.get('/api/companies', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  try {
    const dataPath = path.join(__dirname, '../data/management-companies.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    res.json({
      success: true,
      companies: data.companies,
      updatedAt: data.updatedAt
    });
  } catch (error) {
    console.error('[管理会社DB] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 管理会社DB - 検索（名前またはエイリアスで検索）
 */
app.get('/api/companies/search', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      success: false,
      error: '検索クエリが必要です'
    });
  }

  try {
    const dataPath = path.join(__dirname, '../data/management-companies.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    const query = q.toLowerCase();
    const matches = data.companies.filter(company => {
      // 名前で検索
      if (company.name.toLowerCase().includes(query)) {
        return true;
      }
      // エイリアスで検索
      if (company.aliases.some(alias => alias.toLowerCase().includes(query))) {
        return true;
      }
      return false;
    });

    res.json({
      success: true,
      query: q,
      results: matches
    });
  } catch (error) {
    console.error('[管理会社DB] 検索エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 管理会社DB - 追加/更新
 */
app.post('/api/companies', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { name, platforms, aliases = [], notes = '' } = req.body;

  if (!name || !platforms) {
    return res.status(400).json({
      success: false,
      error: '名前とプラットフォームが必要です'
    });
  }

  try {
    const dataPath = path.join(__dirname, '../data/management-companies.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // 既存の会社を検索
    const existingIndex = data.companies.findIndex(c =>
      c.name.toLowerCase() === name.toLowerCase()
    );

    const companyData = {
      name,
      platforms,
      aliases,
      notes
    };

    if (existingIndex >= 0) {
      // 更新
      data.companies[existingIndex] = companyData;
      console.log('[管理会社DB] 更新:', name);
    } else {
      // 新規追加
      data.companies.push(companyData);
      console.log('[管理会社DB] 追加:', name);
    }

    data.updatedAt = new Date().toISOString();

    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

    res.json({
      success: true,
      company: companyData,
      action: existingIndex >= 0 ? 'updated' : 'created'
    });
  } catch (error) {
    console.error('[管理会社DB] 保存エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 管理会社DB - 削除
 */
app.delete('/api/companies/:name', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { name } = req.params;

  try {
    const dataPath = path.join(__dirname, '../data/management-companies.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    const initialLength = data.companies.length;
    data.companies = data.companies.filter(c =>
      c.name.toLowerCase() !== name.toLowerCase()
    );

    if (data.companies.length === initialLength) {
      return res.status(404).json({
        success: false,
        error: '管理会社が見つかりません'
      });
    }

    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

    console.log('[管理会社DB] 削除:', name);

    res.json({
      success: true,
      message: `${name}を削除しました`
    });
  } catch (error) {
    console.error('[管理会社DB] 削除エラー:', error);
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
