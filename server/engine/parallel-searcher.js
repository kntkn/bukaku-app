/**
 * 並列検索エンジン
 * 複数のプラットフォームを同時にブラウザで検索
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 認証情報を読み込み
const credentialsPath = path.join(__dirname, '../../data/credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

// ウィンドウ配置設定（4隅に配置）
const WINDOW_CONFIG = {
  width: 1200,
  height: 800
};

// 画面サイズ（MacBook想定、複数ウィンドウを配置）
const SCREEN = {
  width: 2560,  // 外部モニター想定
  height: 1440
};

/**
 * 4隅の位置を取得（左上、右上、左下、右下）
 */
function getWindowPosition(index) {
  const positions = [
    { x: 0, y: 25 },                                          // 左上
    { x: SCREEN.width - WINDOW_CONFIG.width, y: 25 },         // 右上
    { x: 0, y: SCREEN.height - WINDOW_CONFIG.height },        // 左下
    { x: SCREEN.width - WINDOW_CONFIG.width, y: SCREEN.height - WINDOW_CONFIG.height }  // 右下
  ];
  return positions[index % 4];
}

/**
 * 単一プラットフォームでの検索
 */
async function searchOnPlatform(platformId, propertyName, onStatus, windowIndex = 0) {
  const platform = credentials.platforms[platformId];
  if (!platform) {
    return { platformId, found: false, error: `Unknown platform: ${platformId}` };
  }

  const position = getWindowPosition(windowIndex);

  const browser = await chromium.launch({
    headless: false,
    args: [
      `--window-position=${position.x},${position.y}`,
      `--window-size=${WINDOW_CONFIG.width},${WINDOW_CONFIG.height}`
    ]
  });

  const context = await browser.newContext({
    viewport: {
      width: WINDOW_CONFIG.width - 20,
      height: WINDOW_CONFIG.height - 80
    }
  });
  const page = await context.newPage();

  try {
    onStatus?.(platformId, 'logging_in', `${platform.name}にログイン中...`);

    // ログインページへ
    await page.goto(platform.loginUrl, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // ページ読み込み完了を待つ
    await page.waitForTimeout(3000);

    // プラットフォームごとのログイン処理
    const loginSuccess = await performLogin(page, platformId, platform);

    if (!loginSuccess) {
      return {
        platformId,
        platform: platform.name,
        found: false,
        error: 'ログイン失敗',
        browser
      };
    }

    onStatus?.(platformId, 'searching', `${platform.name}で「${propertyName}」を検索中...`);

    // 検索実行
    const searchResult = await performSearch(page, platformId, propertyName);

    if (searchResult.found) {
      onStatus?.(platformId, 'found', `${platform.name}でヒット！`);
      return {
        platformId,
        platform: platform.name,
        found: true,
        results: searchResult.results,
        browser,
        page
      };
    } else {
      onStatus?.(platformId, 'not_found', `${platform.name}で該当なし`);
      await browser.close();
      return {
        platformId,
        platform: platform.name,
        found: false,
        error: '該当物件なし'
      };
    }

  } catch (error) {
    console.error(`[${platformId}] エラー:`, error.message);
    await browser.close().catch(() => {});
    return {
      platformId,
      platform: platform.name,
      found: false,
      error: error.message
    };
  }
}

/**
 * プラットフォームごとのログイン処理
 */
async function performLogin(page, platformId, platform) {
  const creds = platform.credentials;

  try {
    switch (platformId) {
      case 'itandi':
        // ITANDIログイン（特殊フロー：1回目→トップページ→再ログインで成功）
        console.log(`[itandi] ログイン開始`);

        // 1回目のログイン試行
        try {
          await page.waitForSelector('input#email', { state: 'visible', timeout: 15000 });
          await page.fill('input#email', creds.email);
          await page.fill('input#password', creds.password);
          await page.click('input[type="submit"]');
          await page.waitForTimeout(5000);
          console.log(`[itandi] 1回目試行後: ${page.url()}`);
        } catch (e) {
          console.log(`[itandi] 1回目ログインエラー: ${e.message}`);
        }

        // トップページに直接アクセス
        console.log(`[itandi] トップページへ遷移...`);
        await page.goto('https://itandibb.com/top', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        console.log(`[itandi] トップ後URL: ${page.url()}`);

        // ログイン済みか確認（topページにいればOK）
        if (page.url().includes('itandibb.com/top')) {
          console.log(`[itandi] ログイン成功（1回目で完了）`);
          return true;
        }

        // ログインページにリダイレクトされた場合、再度ログイン
        if (page.url().includes('login') || page.url().includes('itandi-accounts')) {
          console.log(`[itandi] 2回目ログイン試行...`);

          try {
            await page.waitForSelector('input#email', { state: 'visible', timeout: 15000 });
            await page.fill('input#email', creds.email);
            await page.fill('input#password', creds.password);
            await page.click('input[type="submit"]');
            await page.waitForTimeout(5000);
            await page.waitForLoadState('networkidle').catch(() => {});
            console.log(`[itandi] 2回目試行後: ${page.url()}`);
          } catch (e) {
            console.log(`[itandi] 2回目ログインエラー: ${e.message}`);
          }
        }

        const success = page.url().includes('itandibb.com') && !page.url().includes('login') && !page.url().includes('itandi-accounts');
        console.log(`[itandi] ログイン結果: ${success ? '成功' : '失敗'} - ${page.url()}`);
        return success;

      case 'ierabu':
        // いえらぶBB: プレースホルダーで要素を特定
        await page.waitForSelector('input[placeholder="ログインIDを入力"]', { state: 'visible', timeout: 15000 });
        await page.fill('input[placeholder="ログインIDを入力"]', creds.email);
        await page.fill('input[placeholder="パスワードを入力"]', creds.password);
        await page.click('input#loginButton');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'atbb':
        // ATBB: リダイレクト後のページでログイン
        await page.waitForSelector('input#loginFormText', { state: 'visible', timeout: 15000 });
        await page.fill('input#loginFormText', creds.id);
        await page.fill('input#passFormText', creds.password);
        await page.click('input#loginSubmit');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'essquare':
        // いい物件（いい生活）: OAuth形式 - ボタンクリック後にログイン
        await page.waitForSelector('button:has-text("いい生活アカウントでログイン")', { state: 'visible', timeout: 15000 });
        await page.click('button:has-text("いい生活アカウントでログイン")');
        await page.waitForTimeout(3000);

        // OAuth画面でログイン
        await page.waitForSelector('input[type="email"], input[name="email"], input#email', { state: 'visible', timeout: 15000 }).catch(() => {});
        const emailInput = await page.$('input[type="email"], input[name="email"], input#email');
        if (emailInput) {
          await emailInput.fill(creds.email);
          const passInput = await page.$('input[type="password"], input[name="password"]');
          if (passInput) {
            await passInput.fill(creds.password);
          }
          const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
          if (submitBtn) {
            await submitBtn.click();
          }
          await page.waitForTimeout(5000);
        }
        return page.url().includes('es-square.net') && !page.url().includes('login');

      case 'ambition':
        // アンビション: CakePHP形式
        await page.waitForSelector('input#AccountLoginid', { state: 'visible', timeout: 15000 });
        await page.fill('input#AccountLoginid', creds.id);
        await page.fill('input#AccountPassword', creds.password);
        await page.click('input[type="submit"]');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'shimadahouse':
        // シマダハウス: CakePHP形式（アンビションと同じ）
        await page.waitForSelector('input#AccountLoginid', { state: 'visible', timeout: 15000 });
        await page.fill('input#AccountLoginid', creds.id);
        await page.fill('input#AccountPassword', creds.password);
        await page.click('input[type="submit"]');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'jaamenity':
        // ジェイエーアメニティーハウス: CakePHP形式
        await page.waitForSelector('input#AccountLoginid', { state: 'visible', timeout: 15000 });
        await page.fill('input#AccountLoginid', creds.id);
        await page.fill('input#AccountPassword', creds.password);
        await page.click('input[type="submit"]');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'goodworks':
      case 'jointproperty':
        // bukkaku.jp形式
        await page.waitForSelector('input#account', { state: 'visible', timeout: 15000 });
        await page.fill('input#account', creds.id);
        await page.fill('input#password', creds.password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'seiwa':
        // セイワドットネット
        await page.waitForSelector('input#LoginId', { state: 'visible', timeout: 15000 });
        await page.fill('input#LoginId', creds.email);
        await page.fill('input#PassWord', creds.password);
        await page.click('input#btnLogin');
        await page.waitForTimeout(5000);
        return !page.url().includes('index.php');

      case 'zaitaku':
        // 日本財宅管理サービス
        await page.waitForSelector('input[name="email"], input#email', { state: 'visible', timeout: 15000 });
        await page.fill('input[name="email"], input#email', creds.email);
        await page.fill('input[name="password"], input#password', creds.password);
        await page.click('button[type="submit"], input[type="submit"]');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'kintarou':
        // 金太郎カンパニー
        await page.waitForSelector('input[name="email"], input[type="email"]', { state: 'visible', timeout: 15000 });
        await page.fill('input[name="email"], input[type="email"]', creds.email);
        await page.fill('input[name="password"], input[type="password"]', creds.password);
        await page.click('button[type="submit"], input[type="submit"]');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      case 'daitoservice':
        // 大東建託サービス: 会員IDとユーザーIDが必要
        // 注: 現在のcredentialsには会員IDのみ。追加情報が必要な場合は修正が必要
        await page.waitForSelector('input#member_id', { state: 'visible', timeout: 15000 });
        await page.fill('input#member_id', creds.id);
        // ユーザーIDが設定されていない場合は空欄のまま試行
        await page.fill('input#user_id', creds.userId || '');
        await page.fill('input#password', creds.password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
        return !page.url().includes('login');

      default:
        // 汎用ログイン処理 - 要素が見えるまで待機
        {
          await page.waitForSelector('input[type="email"], input[name="email"], input#email, input[name="userId"], input#userId, input[name="id"]', { state: 'visible', timeout: 15000 }).catch(() => {});

          const genericEmailInput = await page.$('input[type="email"], input[name="email"], input#email, input[name="userId"], input#userId, input[name="id"]');
          const genericPassInput = await page.$('input[type="password"], input[name="password"], input#password');
          const genericSubmitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("ログイン"), a:has-text("ログイン")');

          if (genericEmailInput && genericPassInput && genericSubmitBtn) {
            await genericEmailInput.fill(creds.email || creds.id || '');
            await genericPassInput.fill(creds.password);
            await genericSubmitBtn.click();
            await page.waitForTimeout(5000);
            return !page.url().includes('login');
          }
          return false;
        }
    }
  } catch (error) {
    console.error(`[${platformId}] ログインエラー:`, error.message);
    return false;
  }
}

/**
 * プラットフォームごとの検索処理
 */
async function performSearch(page, platformId, propertyName) {
  try {
    switch (platformId) {
      case 'itandi':
        console.log(`[itandi] 検索開始: "${propertyName}"`);
        console.log(`[itandi] 現在のURL: ${page.url()}`);

        // リスト検索ページへ移動（居住用部屋の「リスト検索」をクリック）
        try {
          // まず「リスト検索」リンクを探す
          await page.waitForSelector('text=リスト検索', { timeout: 10000 });
          const listSearchBtns = await page.$$('text=リスト検索');
          console.log(`[itandi] リスト検索ボタン数: ${listSearchBtns.length}`);

          if (listSearchBtns.length > 0) {
            await listSearchBtns[0].click();  // 最初の「リスト検索」（居住用）
            await page.waitForTimeout(3000);
            await page.waitForLoadState('networkidle').catch(() => {});
          }
        } catch (e) {
          console.log(`[itandi] リスト検索ボタンが見つからない: ${e.message}`);
        }

        console.log(`[itandi] 検索ページURL: ${page.url()}`);

        // 物件名入力欄を待つ
        try {
          await page.waitForSelector('input[name="building_name:match"]', { timeout: 10000 });
        } catch {
          console.log(`[itandi] 物件名入力欄が見つからない`);
          return { found: false, results: [] };
        }

        // 物件名を入力
        await page.fill('input[name="building_name:match"]', propertyName);
        console.log(`[itandi] 物件名入力完了`);

        // 検索ボタンの状態確認
        const searchBtn = await page.$('button[type="submit"]');
        if (searchBtn) {
          const isDisabled = await searchBtn.isDisabled();
          console.log(`[itandi] 検索ボタン disabled: ${isDisabled}`);

          if (isDisabled) {
            // 所在地を設定して検索ボタンを有効化
            console.log(`[itandi] 所在地を設定中...`);
            await page.click('button:has-text("所在地で絞り込み")');
            await page.waitForTimeout(1000);
            await page.click('text=関東');
            await page.waitForTimeout(500);
            await page.click('text=東京都');
            await page.waitForTimeout(500);
            await page.click('button:has-text("確定")');
            await page.waitForTimeout(2000);
          }

          // 検索実行
          await searchBtn.click();
          console.log(`[itandi] 検索ボタンクリック`);
          await page.waitForTimeout(5000);
          await page.waitForLoadState('networkidle').catch(() => {});
        }

        console.log(`[itandi] 検索結果ページ: ${page.url()}`);
        return await extractItandiResults(page, propertyName);

      case 'ierabu':
        // いえらぶの検索処理
        const ierabuSearchInput = await page.$('input[name="building_name"], input[placeholder*="物件名"]');
        if (ierabuSearchInput) {
          await ierabuSearchInput.fill(propertyName);
          await page.click('button[type="submit"], button:has-text("検索")');
          await page.waitForTimeout(5000);
        }
        return await extractGenericResults(page, propertyName);

      case 'atbb':
        // ATBBの検索処理
        const atbbSearchInput = await page.$('input[name="keyword"], input[placeholder*="物件名"]');
        if (atbbSearchInput) {
          await atbbSearchInput.fill(propertyName);
          await page.click('button[type="submit"], button:has-text("検索")');
          await page.waitForTimeout(5000);
        }
        return await extractGenericResults(page, propertyName);

      default:
        // 汎用検索処理
        const searchInput = await page.$('input[type="search"], input[name="keyword"], input[placeholder*="検索"], input[placeholder*="物件"]');
        if (searchInput) {
          await searchInput.fill(propertyName);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(5000);
        }
        return await extractGenericResults(page, propertyName);
    }
  } catch (error) {
    console.error(`[${platformId}] 検索エラー:`, error.message);
    return { found: false, results: [] };
  }
}

/**
 * ITANDI検索結果を抽出
 */
async function extractItandiResults(page, propertyName) {
  const results = [];
  const cards = await page.$$('.itandi-bb-ui__Box.css-1tqsbsd').catch(() => []);

  for (const card of cards.slice(0, 10)) {
    const cardText = await card.textContent();

    if (!cardText.includes(propertyName)) continue;

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

  return { found: results.length > 0, results };
}

/**
 * 汎用検索結果抽出
 */
async function extractGenericResults(page, propertyName) {
  const pageText = await page.textContent('body');

  if (pageText.includes(propertyName)) {
    // 物件名がページ内に存在する
    const result = {
      raw_text: pageText.substring(0, 500),
      status: 'unknown',
      has_ad: false,
      viewing_available: false
    };

    if (pageText.includes('募集中') || pageText.includes('空室')) {
      result.status = 'available';
    } else if (pageText.includes('申込') || pageText.includes('商談')) {
      result.status = 'applied';
    }

    if (pageText.includes('広告費') || pageText.includes('AD')) {
      result.has_ad = true;
    }

    return { found: true, results: [result] };
  }

  return { found: false, results: [] };
}

/**
 * 全プラットフォームで並列検索（4つずつバッチ処理）
 */
async function parallelSearch(propertyName, options = {}) {
  const {
    platforms = credentials.priority,
    batchSize = 4,  // 同時実行数
    onStatus = () => {},
    onComplete = () => {}
  } = options;

  console.log(`[並列検索] 開始: "${propertyName}" (${platforms.length}プラットフォーム, ${batchSize}並列)`);

  const allHits = [];
  const allMisses = [];
  const allErrors = [];

  // バッチごとに処理
  for (let i = 0; i < platforms.length; i += batchSize) {
    const batch = platforms.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(platforms.length / batchSize);

    console.log(`[並列検索] バッチ ${batchNum}/${totalBatches}: ${batch.join(', ')}`);

    // バッチ内で並列実行
    const searchPromises = batch.map((platformId, idx) =>
      searchOnPlatform(platformId, propertyName, onStatus, idx)
    );

    const results = await Promise.allSettled(searchPromises);

    // 結果を分類
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.found) {
          allHits.push(result.value);
        } else {
          allMisses.push(result.value);
        }
      } else {
        allErrors.push({ error: result.reason?.message || 'Unknown error' });
      }
    }

    // ヒットがあったら早期終了（オプション）
    if (allHits.length > 0 && options.stopOnFirstHit) {
      console.log(`[並列検索] ヒット発見、検索終了`);
      break;
    }
  }

  console.log(`[並列検索] 完了: ヒット=${allHits.length}, ミス=${allMisses.length}, エラー=${allErrors.length}`);

  onComplete({ hits: allHits, misses: allMisses, errors: allErrors });

  return { hits: allHits, misses: allMisses, errors: allErrors };
}

module.exports = {
  parallelSearch,
  searchOnPlatform,
  credentials
};
