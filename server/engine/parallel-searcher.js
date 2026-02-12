/**
 * 並列検索エンジン
 * 複数のプラットフォームを同時にブラウザで検索
 * 操作手順はplatform-skills.jsonから読み込み
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 認証情報を読み込み（ファイルがなければ空のデフォルト）
const credentialsPath = path.join(__dirname, '../../data/credentials.json');
let credentials = { priority: [], platforms: {} };
try {
  credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
} catch (e) {
  console.warn('[parallel-searcher] credentials.json not found, using empty defaults');
}

// 操作手順を読み込み
const skillsPath = path.join(__dirname, '../../data/platform-skills.json');
const platformSkills = JSON.parse(fs.readFileSync(skillsPath, 'utf-8'));

/**
 * AD値を月数に正規化
 * 100% = 1.0ヶ月、50% = 0.5ヶ月、1ヶ月 = 1.0 など
 * @param {string} rawAdValue - 生のAD値（"100%", "1ヶ月", "0.5ヶ月分" など）
 * @returns {string|null} "#.#" 形式の月数文字列、正規化不可の場合はnull
 */
function normalizeAdToMonths(rawAdValue) {
  if (!rawAdValue || rawAdValue === 'あり') return null;

  const str = rawAdValue.trim();

  // AD接頭辞付き数値: AD150 = 150% = 1.5ヶ月（goweb.work系サイト）
  const adPrefixMatch = str.match(/AD\s*(\d+(?:\.\d+)?)/i);
  if (adPrefixMatch) {
    return (parseFloat(adPrefixMatch[1]) / 100).toFixed(1);
  }

  // パーセンテージ: 100% = 1.0ヶ月
  const percentMatch = str.match(/([0-9]+(?:\.[0-9]+)?)\s*[%％]/);
  if (percentMatch) {
    return (parseFloat(percentMatch[1]) / 100).toFixed(1);
  }

  // 月数: 1ヶ月 = 1.0, 1.5ヶ月分 = 1.5
  const monthMatch = str.match(/([0-9]+(?:\.[0-9]+)?)\s*ヶ?月/);
  if (monthMatch) {
    return parseFloat(monthMatch[1]).toFixed(1);
  }

  // 数字のみ（月数とみなす）
  const numMatch = str.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (numMatch) {
    return parseFloat(numMatch[1]).toFixed(1);
  }

  return null;
}

// ビューポート設定（PC全画面サイズ）
const VIEWPORT_CONFIG = {
  width: 1920,
  height: 1080
};

/**
 * 変数を値に置換
 * ${email} → creds.email など
 */
function replaceVariables(value, creds, propertyName, roomNumber = '') {
  if (typeof value !== 'string') return value;

  // 部屋番号から数字のみ抽出（"101号室" → "101"）
  const numericRoomNumber = (roomNumber || '').replace(/[^0-9]/g, '');

  return value
    .replace(/\$\{email\}/g, creds.email || '')
    .replace(/\$\{password\}/g, creds.password || '')
    .replace(/\$\{id\}/g, creds.id || '')
    .replace(/\$\{userId\}/g, creds.userId || '')
    .replace(/\$\{propertyName\}/g, propertyName || '')
    .replace(/\$\{roomNumber\}/g, numericRoomNumber);
}

/**
 * 単一ステップを実行
 */
// 高速化: デフォルトタイムアウトを短縮
const DEFAULT_TIMEOUT = 5000;  // 15秒 → 5秒
const GOTO_TIMEOUT = 10000;    // 30秒 → 10秒

async function executeStep(page, step, creds, propertyName, roomNumber = '') {
  const action = step.action;
  const selector = replaceVariables(step.selector, creds, propertyName, roomNumber);
  const value = replaceVariables(step.value, creds, propertyName, roomNumber);

  try {
    switch (action) {
      case 'waitFor':
        await page.waitForSelector(selector, {
          state: 'visible',
          timeout: step.timeout || DEFAULT_TIMEOUT
        });
        break;

      case 'fill':
        if (step.optional) {
          const element = await page.$(selector);
          if (element) await element.fill(value);
        } else {
          await page.fill(selector, value);
        }
        break;

      case 'click':
        if (step.index !== undefined) {
          const elements = await page.$$(selector);
          if (elements[step.index]) {
            await elements[step.index].click();
          }
        } else {
          await page.click(selector);
        }
        break;

      case 'wait':
        // 固定waitは最大1秒に制限（高速化）
        await page.waitForTimeout(Math.min(step.ms || 500, 1000));
        break;

      case 'smartWait':
        // 賢い待機: セレクタが出るまで or タイムアウト
        if (step.selector) {
          await page.waitForSelector(step.selector, {
            state: 'visible',
            timeout: step.timeout || DEFAULT_TIMEOUT
          }).catch(() => {});
        } else {
          await page.waitForLoadState('domcontentloaded', {
            timeout: step.timeout || DEFAULT_TIMEOUT
          }).catch(() => {});
        }
        break;

      case 'goto':
        await page.goto(step.url, {
          timeout: GOTO_TIMEOUT,
          waitUntil: 'domcontentloaded'  // networkidle → domcontentloaded
        }).catch(() => {});
        break;

      case 'pressKey':
        await page.keyboard.press(step.key);
        break;

      case 'waitForLoad':
        // networkidle → domcontentloaded（高速化）
        await page.waitForLoadState('domcontentloaded', {
          timeout: DEFAULT_TIMEOUT
        }).catch(() => {});
        break;
    }
    return true;
  } catch (error) {
    if (step.optional) {
      console.log(`[Step] Optional step failed: ${action} - ${error.message}`);
      return true;
    }
    console.error(`[Step] Failed: ${action} ${selector} - ${error.message}`);
    return false;
  }
}

/**
 * ステップ配列を順次実行
 */
async function executeSteps(page, steps, creds, propertyName, roomNumber = '') {
  for (const step of steps) {
    const success = await executeStep(page, step, creds, propertyName, roomNumber);
    if (!success && !step.optional) {
      return false;
    }
  }
  return true;
}

/**
 * 成功判定を実行
 */
function checkSuccess(pageUrl, successCheck) {
  if (!successCheck) return true;

  let success = true;

  if (successCheck.urlContains) {
    success = success && pageUrl.includes(successCheck.urlContains);
  }

  if (successCheck.urlNotContains) {
    const notContains = Array.isArray(successCheck.urlNotContains)
      ? successCheck.urlNotContains
      : [successCheck.urlNotContains];
    success = success && notContains.every(s => !pageUrl.includes(s));
  }

  return success;
}

/**
 * JSONベースのログイン処理
 */
async function performLogin(page, platformId, platform) {
  const skills = platformSkills[platformId];
  const creds = platform.credentials;

  if (!skills || !skills.login) {
    console.log(`[${platformId}] No login skills defined, using fallback`);
    return await fallbackLogin(page, creds);
  }

  console.log(`[${platformId}] Executing login steps...`);

  // メインのログインステップを実行
  const loginSuccess = await executeSteps(page, skills.login.steps, creds, '');

  if (!loginSuccess) {
    console.log(`[${platformId}] Login steps failed`);
    return false;
  }

  // ログイン後のチェック（トップページに遷移するなど）
  if (skills.login.afterLoginCheck) {
    const check = skills.login.afterLoginCheck;
    if (check.action === 'goto' && check.url) {
      console.log(`[${platformId}] After login: navigating to ${check.url}`);
      await page.goto(check.url, { timeout: 30000 }).catch(() => {});
      if (check.wait) {
        await page.waitForTimeout(check.wait);
      }
    }
  }

  // リトライ条件をチェック（ログイン画面に戻された場合）
  if (skills.login.retryLogin) {
    const retry = skills.login.retryLogin;
    const needsRetry = retry.condition.urlContains && page.url().includes(retry.condition.urlContains);

    if (needsRetry) {
      console.log(`[${platformId}] Retry login required (redirected to login)...`);
      await executeSteps(page, retry.steps, creds, '');
    }
  }

  // 成功判定
  const success = checkSuccess(page.url(), skills.login.successCheck);
  console.log(`[${platformId}] Login result: ${success ? 'SUCCESS' : 'FAILED'} - ${page.url()}`);

  return success;
}

/**
 * JSONベースの検索処理
 * @param {Page} page - Playwrightページ
 * @param {string} platformId - プラットフォームID
 * @param {string} propertyName - 物件名
 * @param {string} roomNumber - 部屋番号（オプション）
 * @param {Object} options - オプション
 * @param {boolean} options.skipPreSteps - preStepsをスキップ（連続検索時）
 */
async function performSearch(page, platformId, propertyName, roomNumber = '', options = {}) {
  const { skipPreSteps = false, onStep = () => {} } = options;
  const skills = platformSkills[platformId];
  const platform = credentials.platforms[platformId];
  const creds = platform?.credentials || {};
  const platformName = platform?.name || platformId;

  if (!skills || !skills.search) {
    console.log(`[${platformId}] No search skills defined, using fallback`);
    return await fallbackSearch(page, propertyName);
  }

  // RPA禁止プラットフォームをスキップ
  if (skills.rpaProhibited) {
    console.log(`[${platformId}] RPA prohibited by site terms - skipping`);
    return { status: 'SKIPPED', reason: 'RPA禁止（サイト利用規約）' };
  }

  // 複雑なナビゲーションが必要なプラットフォームをスキップ
  if (skills.complexNavigation || skills.search.requiresManualNavigation) {
    console.log(`[${platformId}] Complex navigation required - skipping automated search`);
    return { status: 'SKIPPED', reason: '手動操作が必要（複雑なUI構造）' };
  }

  // 検索が無効化されている場合
  if (skills.search.disabled) {
    console.log(`[${platformId}] Search disabled for this platform`);
    return { status: 'SKIPPED', reason: '検索無効' };
  }

  const searchTarget = roomNumber ? `${propertyName} (${roomNumber})` : propertyName;
  console.log(`[${platformId}] Executing search steps for: "${searchTarget}"`);

  // preSteps（検索ページへの遷移など）- 連続検索時はスキップ
  if (skills.search.preSteps && !skipPreSteps) {
    onStep({ platformId, message: `${platformName}の検索ページを開いています...` });
    await executeSteps(page, skills.search.preSteps, creds, propertyName, roomNumber);
  }

  // 連続検索時は検索フォームをクリアしてから入力
  if (skipPreSteps && skills.search.steps) {
    onStep({ platformId, message: `検索フォームをクリア中...` });
    try {
      const inputSelector = skills.search.steps.find(s => s.action === 'fill')?.selector;
      if (inputSelector) {
        await page.fill(inputSelector, '');
        await page.waitForTimeout(300);
      }
    } catch (e) {
      // クリア失敗は無視
    }
  }

  // メインの検索ステップ
  onStep({ platformId, message: `「${propertyName}」を入力中...` });
  await executeSteps(page, skills.search.steps, creds, propertyName, roomNumber);

  // 部屋番号入力ステップ（定義されていれば実行）
  if (roomNumber && skills.search.roomNumberSteps) {
    onStep({ platformId, message: `部屋番号「${roomNumber}」を入力中...` });
    console.log(`[${platformId}] Filling room number: "${roomNumber}"`);
    await executeSteps(page, skills.search.roomNumberSteps, creds, propertyName, roomNumber);
  }

  // 結果抽出
  onStep({ platformId, message: `${platformName}で結果を確認中...` });
  return await extractResults(page, platformId, propertyName, skills.search.resultExtraction);
}

/**
 * 検索結果の抽出
 */
async function extractResults(page, platformId, propertyName, extraction) {
  const skills = platformSkills[platformId];

  // カスタム結果セレクタがある場合
  if (skills?.search?.resultSelector) {
    const cards = await page.$$(skills.search.resultSelector).catch(() => []);
    const results = [];

    for (const card of cards.slice(0, 10)) {
      const cardText = await card.textContent();

      if (!cardText.includes(propertyName)) continue;

      // AD専用セレクタがあれば、そのセレクタのテキストを取得
      let adText = null;
      if (extraction?.adSelector) {
        try {
          const adElement = await card.$(extraction.adSelector);
          if (adElement) {
            adText = await adElement.textContent();
          }
        } catch (e) {
          // adSelector取得失敗はフルテキストにフォールバック
        }
      }

      const result = extractResultInfo(cardText, extraction, adText);

      // Web申し込みバッジの確認（MuiBadge等）
      if (extraction?.applicationBadgeSelector) {
        try {
          const badges = await card.$$(extraction.applicationBadgeSelector);
          for (const badge of badges) {
            const badgeText = await badge.textContent();
            const count = parseInt(badgeText.trim(), 10);
            if (count >= 1) {
              result.status = 'applied';
              result.web_application_count = count;
              break;
            }
          }
        } catch (e) {
          // バッジ取得失敗は無視
        }
      }

      results.push(result);
    }

    return { found: results.length > 0, results };
  }

  // 汎用抽出
  return await extractGenericResults(page, propertyName, extraction);
}

/**
 * 結果情報を抽出
 */
/**
 * @param {string} text - カード全体のテキスト
 * @param {Object} extraction - resultExtraction設定
 * @param {string|null} adText - adSelectorで取得したAD専用テキスト（あれば優先）
 */
function extractResultInfo(text, extraction, adText = null) {
  const result = {
    raw_text: text.substring(0, 300),
    status: 'unknown',
    has_ad: false,
    ad_info: null,
    ad_months: null,
    viewing_available: false
  };

  if (extraction?.statusPatterns) {
    const patterns = extraction.statusPatterns;
    if (patterns.available?.some(p => text.includes(p))) {
      result.status = 'available';
    } else if (patterns.applied?.some(p => text.includes(p))) {
      result.status = 'applied';
    } else if (patterns.unavailable?.some(p => text.includes(p))) {
      result.status = 'unavailable';
    }
  } else {
    if (text.includes('募集中') || text.includes('空室')) {
      result.status = 'available';
    } else if (text.includes('申込') || text.includes('商談')) {
      result.status = 'applied';
    } else if (text.includes('成約') || text.includes('募集終了')) {
      result.status = 'unavailable';
    }
  }

  // AD情報を抽出
  // adSelector経由でテキスト取得済みの場合は直接処理（キーワード不要）
  // そうでなければカード全体からキーワード検索
  if (adText) {
    const trimmed = adText.trim();
    // 「無し」「-」「なし」は AD なし
    if (trimmed && trimmed !== '-' && trimmed !== '無し' && trimmed !== 'なし') {
      result.has_ad = true;
      result.ad_info = trimmed;
    }
  } else {
    const adPatterns = extraction?.adPatterns || ['広告費', 'AD', '広告料', '業者報酬'];
    if (adPatterns.some(p => text.includes(p))) {
      result.has_ad = true;

      const adRegexPatterns = [
        /(?:AD|広告費|広告料|業者報酬)[：:\s]*([0-9]+(?:\.[0-9]+)?[%％])/i,
        /(?:AD|広告費|広告料|業者報酬)[：:\s]*([0-9]+(?:\.[0-9]+)?ヶ?月)/i,
        /(?:AD|広告費|広告料|業者報酬)[：:\s]*([0-9]+万円?)/i,
        /(AD\d+(?:\.\d+)?)/i,  // goweb.work: "AD150" → "AD150"
        /([0-9]+(?:\.[0-9]+)?[%％]).*(?:AD|広告)/i,
        /([0-9]+(?:\.[0-9]+)?ヶ?月).*(?:AD|広告)/i
      ];

      for (const regex of adRegexPatterns) {
        const match = text.match(regex);
        if (match && match[1]) {
          result.ad_info = match[1].trim();
          break;
        }
      }

      if (!result.ad_info) {
        result.ad_info = 'あり';
      }
    }
  }

  // AD値を月数に正規化 (#.# 形式)
  result.ad_months = normalizeAdToMonths(result.ad_info);

  const viewingPatterns = extraction?.viewingPatterns || ['内見可', '即内見'];
  if (viewingPatterns.some(p => text.includes(p))) {
    result.viewing_available = true;
  }

  return result;
}

/**
 * 汎用検索結果抽出
 */
async function extractGenericResults(page, propertyName, extraction) {
  const pageText = await page.textContent('body');

  if (pageText.includes(propertyName)) {
    const result = extractResultInfo(pageText, extraction);
    result.raw_text = pageText.substring(0, 500);
    return { found: true, results: [result] };
  }

  return { found: false, results: [] };
}

/**
 * フォールバック: 汎用ログイン処理
 */
async function fallbackLogin(page, creds) {
  try {
    await page.waitForSelector(
      'input[type="email"], input[name="email"], input#email, input[name="userId"], input#userId, input[name="id"]',
      { state: 'visible', timeout: 15000 }
    ).catch(() => {});

    const emailInput = await page.$('input[type="email"], input[name="email"], input#email, input[name="userId"], input#userId, input[name="id"]');
    const passInput = await page.$('input[type="password"], input[name="password"], input#password');
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("ログイン")');

    if (emailInput && passInput && submitBtn) {
      await emailInput.fill(creds.email || creds.id || '');
      await passInput.fill(creds.password);
      await submitBtn.click();
      await page.waitForTimeout(5000);
      return !page.url().includes('login');
    }
    return false;
  } catch (error) {
    console.error('Fallback login error:', error.message);
    return false;
  }
}

/**
 * フォールバック: 汎用検索処理
 */
async function fallbackSearch(page, propertyName) {
  try {
    const searchInput = await page.$('input[type="search"], input[name="keyword"], input[placeholder*="検索"], input[placeholder*="物件"]');
    if (searchInput) {
      await searchInput.fill(propertyName);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
    }
    return await extractGenericResults(page, propertyName);
  } catch (error) {
    console.error('Fallback search error:', error.message);
    return { found: false, results: [] };
  }
}

/**
 * 単一プラットフォームでの検索
 * @param {string} platformId - プラットフォームID
 * @param {string} propertyName - 物件名
 * @param {Function} onStatus - ステータスコールバック
 * @param {number} windowIndex - ウィンドウインデックス
 * @param {string} roomNumber - 部屋番号（オプション）
 */
async function searchOnPlatform(platformId, propertyName, onStatus, windowIndex = 0, roomNumber = '') {
  const platform = credentials.platforms[platformId];
  if (!platform) {
    return { platformId, found: false, error: `Unknown platform: ${platformId}` };
  }

  // headlessモードで起動（ウィンドウは表示しない）
  const browser = await chromium.launch({
    headless: true
  });

  // PC全画面サイズのviewport（レスポンシブでスマホUIにならないように）
  const context = await browser.newContext({
    viewport: {
      width: VIEWPORT_CONFIG.width,
      height: VIEWPORT_CONFIG.height
    }
  });
  const page = await context.newPage();

  try {
    onStatus?.(platformId, 'logging_in', `${platform.name}にログイン中...`);

    await page.goto(platform.loginUrl, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await page.waitForTimeout(3000);

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

    const searchTarget = roomNumber ? `${propertyName} ${roomNumber}` : propertyName;
    onStatus?.(platformId, 'searching', `${platform.name}で「${searchTarget}」を検索中...`);

    const searchResult = await performSearch(page, platformId, propertyName, roomNumber);

    // SKIPPEDステータスの処理（RPA禁止、複雑なナビゲーション等）
    if (searchResult.status === 'SKIPPED') {
      onStatus?.(platformId, 'skipped', `${platform.name}: ${searchResult.reason}`);
      await browser.close();
      return {
        platformId,
        platform: platform.name,
        found: false,
        skipped: true,
        reason: searchResult.reason
      };
    }

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
 * 全プラットフォームで並列検索（4ワーカープール方式）
 * 常に4つのブラウザが稼働し、1つ終わったら即座に次のサイトを開始
 */
async function parallelSearch(propertyName, options = {}) {
  const {
    platforms = credentials.priority,
    concurrency = 4,
    onStatus = () => {},
    onComplete = () => {},
    onScreenshot = null
  } = options;

  console.log(`[並列検索] 開始: "${propertyName}" (${platforms.length}プラットフォーム, ${concurrency}並列)`);

  const allHits = [];
  const allMisses = [];
  const allErrors = [];

  // プラットフォームキュー（残りのサイト）
  const queue = [...platforms];
  let completedCount = 0;
  let found = false;

  // ワーカー関数（1つのブラウザが担当）
  const worker = async (workerIndex) => {
    while (queue.length > 0 && !found) {
      const platformId = queue.shift();
      if (!platformId) break;

      const platform = credentials.platforms[platformId];
      console.log(`[Worker${workerIndex}] ${platform?.name || platformId} 検索開始`);

      try {
        const result = await searchOnPlatform(platformId, propertyName, onStatus, workerIndex);
        completedCount++;

        if (result.found) {
          allHits.push(result);
          found = true;  // 見つかったらフラグを立てる（他のワーカーも終了へ）
          console.log(`[Worker${workerIndex}] ヒット！ ${platform?.name}で発見`);
        } else {
          allMisses.push(result);
          console.log(`[Worker${workerIndex}] ${platform?.name}: 該当なし (${completedCount}/${platforms.length})`);
        }
      } catch (error) {
        completedCount++;
        console.error(`[Worker${workerIndex}] ${platformId} エラー:`, error.message);
        allErrors.push({ platformId, error: error.message });
      }
    }
  };

  // 4つのワーカーを同時起動
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, platforms.length); i++) {
    workers.push(worker(i));
  }

  // 全ワーカーの完了を待つ
  await Promise.all(workers);

  const success = allHits.length > 0;
  console.log(`[並列検索] 完了: ${success ? 'ヒット' : '該当なし'} (検索=${completedCount}/${platforms.length})`);

  onComplete({ hits: allHits, misses: allMisses, errors: allErrors });

  return {
    success,
    hits: allHits,
    misses: allMisses,
    errors: allErrors
  };
}

/**
 * 1回ログインして複数物件を連続検索（同一プラットフォーム用）
 * @param {string} platformId - プラットフォームID
 * @param {Array} properties - 検索する物件リスト
 * @param {Object} options - オプション（onStatus, onScreenshot, onResult）
 * @returns {Array} 検索結果リスト
 */
async function searchMultipleOnPlatform(platformId, properties, options = {}) {
  const { onStatus, onScreenshot, onResult } = options;
  const platform = credentials.platforms[platformId];

  if (!platform) {
    return properties.map(prop => ({
      property: prop,
      platformId,
      found: false,
      error: `Unknown platform: ${platformId}`
    }));
  }

  console.log(`[連続検索] ${platform.name}で${properties.length}件を検索開始`);

  // ブラウザ起動（1回だけ）
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_CONFIG.width, height: VIEWPORT_CONFIG.height }
  });
  const page = await context.newPage();

  // スクリーンショット定期送信
  let screenshotInterval = null;
  if (onScreenshot) {
    screenshotInterval = setInterval(async () => {
      try {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 50 });
        onScreenshot({
          platformId,
          image: `data:image/jpeg;base64,${buffer.toString('base64')}`
        });
      } catch (e) {
        // 無視
      }
    }, 500);
  }

  const results = [];

  try {
    // ログイン（1回だけ）
    onStatus?.(platformId, 'logging_in', `${platform.name}にログイン中...`);
    await page.goto(platform.loginUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const loginSuccess = await performLogin(page, platformId, platform);

    if (!loginSuccess) {
      // ログイン失敗 → 全物件エラー
      for (const prop of properties) {
        results.push({
          property: prop,
          platformId,
          platform: platform.name,
          found: false,
          error: 'ログイン失敗'
        });
        onResult?.(results[results.length - 1]);
      }
      return results;
    }

    // 各物件を連続検索
    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      const propertyName = prop.property_name || '不明';
      const roomNumber = prop.room_number || '';
      const searchTarget = roomNumber ? `${propertyName} ${roomNumber}` : propertyName;

      onStatus?.(platformId, 'searching', `${platform.name}: ${searchTarget}を検索中 (${i + 1}/${properties.length})`);

      try {
        // 2件目以降はpreStepsをスキップ（既に検索画面にいるため）
        const searchResult = await performSearch(page, platformId, propertyName, roomNumber, {
          skipPreSteps: i > 0
        });

        const result = {
          property: prop,
          platformId,
          platform: platform.name,
          found: searchResult.found,
          results: searchResult.results || [],
          error: searchResult.found ? null : '該当物件なし'
        };

        results.push(result);
        onResult?.(result);

        if (searchResult.found) {
          console.log(`[連続検索] ${platform.name}: ${searchTarget} → ヒット！`);
        } else {
          console.log(`[連続検索] ${platform.name}: ${searchTarget} → 該当なし`);
        }

        // 次の検索前に少し待機（サーバー負荷軽減）
        if (i < properties.length - 1) {
          await page.waitForTimeout(1000);
        }
      } catch (error) {
        console.error(`[連続検索] ${propertyName} 検索エラー:`, error.message);
        results.push({
          property: prop,
          platformId,
          platform: platform.name,
          found: false,
          error: error.message
        });
        onResult?.(results[results.length - 1]);
      }
    }

  } catch (error) {
    console.error(`[連続検索] ${platformId} 全体エラー:`, error.message);
    // 未処理の物件をエラーとして追加
    for (const prop of properties) {
      if (!results.find(r => r.property === prop)) {
        results.push({
          property: prop,
          platformId,
          platform: platform.name,
          found: false,
          error: error.message
        });
      }
    }
  } finally {
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
    }
    await browser.close().catch(() => {});
  }

  console.log(`[連続検索] ${platform.name}完了: ${results.filter(r => r.found).length}/${results.length}件ヒット`);

  return results;
}

/**
 * スキルをリロード（動的更新用）
 */
function reloadSkills() {
  const newSkills = JSON.parse(fs.readFileSync(skillsPath, 'utf-8'));
  Object.assign(platformSkills, newSkills);
  console.log('[Skills] Reloaded platform skills');
}

module.exports = {
  parallelSearch,
  searchOnPlatform,
  searchMultipleOnPlatform,
  performLogin,
  performSearch,
  normalizeAdToMonths,
  credentials,
  platformSkills,
  reloadSkills
};
