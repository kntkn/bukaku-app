/**
 * ブラウザプール管理
 * ログイン時: ブラウザ起動→ログイン→セッション保存→ブラウザ閉じる（メモリ解放）
 * 検索時: 必要なブラウザだけオンデマンドで起動（セッション復元）
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
  console.warn('[browser-pool] credentials.json not found or invalid, using empty defaults:', e.message);
}

// セッション保存ディレクトリ
const SESSION_DIR = path.join(__dirname, '../../data/sessions');

// 環境変数から設定
const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS || '15', 10);
const VIEWPORT_CONFIG = { width: 1920, height: 1080 };

/**
 * ブラウザプールクラス
 * - ログイン済みプラットフォームをSetで管理（メモリ軽量）
 * - ブラウザはオンデマンド起動・使用後に閉じる
 * - セッションをファイルに永続化
 */
class BrowserPool {
  constructor() {
    this.browsers = new Map();  // platformId → { browser, context, page, loggedIn }
    this.loggedInPlatforms = new Set();  // ログイン済みプラットフォームID（ブラウザ閉じても維持）
    this.initialized = false;
    this.initializing = false;
  }

  /**
   * セッション保存ディレクトリを作成
   */
  ensureSessionDir() {
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
  }

  /**
   * プラットフォームのセッションパス
   */
  getSessionPath(platformId) {
    return path.join(SESSION_DIR, `${platformId}.json`);
  }

  /**
   * セッションファイルの存在チェック
   */
  hasSession(platformId) {
    return fs.existsSync(this.getSessionPath(platformId));
  }

  /**
   * 単一プラットフォームのブラウザを起動
   */
  async launchBrowser(platformId) {
    const platform = credentials.platforms[platformId];
    if (!platform) {
      console.log(`[BrowserPool] Unknown platform: ${platformId}`);
      return null;
    }

    this.ensureSessionDir();
    const sessionPath = this.getSessionPath(platformId);

    try {
      // セッションファイルがあれば読み込み
      let storageState = undefined;
      if (fs.existsSync(sessionPath)) {
        try {
          storageState = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
          console.log(`[BrowserPool] ${platformId}: セッション読み込み`);
        } catch (e) {
          console.log(`[BrowserPool] ${platformId}: セッション読み込み失敗、新規作成`);
        }
      }

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: VIEWPORT_CONFIG,
        storageState: storageState
      });
      const page = await context.newPage();

      // リソースブロック（高速化）- 画像/フォント/メディア/広告をスキップ
      await page.route('**/*', route => {
        const resourceType = route.request().resourceType();
        const url = route.request().url();

        // ブロック対象
        if (['image', 'font', 'media'].includes(resourceType)) {
          return route.abort();
        }
        // 広告・トラッキングをブロック
        if (url.includes('google-analytics') ||
            url.includes('googletagmanager') ||
            url.includes('facebook') ||
            url.includes('doubleclick') ||
            url.includes('adservice')) {
          return route.abort();
        }
        return route.continue();
      });

      const loggedIn = this.loggedInPlatforms.has(platformId);
      this.browsers.set(platformId, {
        browser,
        context,
        page,
        platform,
        loggedIn,
        lastUsed: Date.now()
      });

      console.log(`[BrowserPool] ${platformId}: ブラウザ起動完了（loggedIn=${loggedIn}）`);
      return this.browsers.get(platformId);

    } catch (error) {
      console.error(`[BrowserPool] ${platformId}: ブラウザ起動失敗 - ${error.message}`);
      return null;
    }
  }

  /**
   * 全プラットフォームのブラウザを並列起動
   */
  async initializeAll(platformIds = null) {
    if (this.initializing) {
      console.log('[BrowserPool] Already initializing, waiting...');
      while (this.initializing) {
        await new Promise(r => setTimeout(r, 100));
      }
      return;
    }

    this.initializing = true;
    const targets = platformIds || credentials.priority.slice(0, MAX_BROWSERS);

    console.log(`[BrowserPool] ${targets.length}個のブラウザを並列起動中...`);

    const results = await Promise.allSettled(
      targets.map(pid => this.launchBrowser(pid))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`[BrowserPool] 起動完了: ${succeeded}/${targets.length}`);

    this.initialized = true;
    this.initializing = false;
  }

  /**
   * プラットフォームのブラウザを取得（なければ起動）
   */
  async getBrowser(platformId) {
    if (!this.browsers.has(platformId)) {
      await this.launchBrowser(platformId);
    }
    const entry = this.browsers.get(platformId);
    if (entry) {
      entry.lastUsed = Date.now();
    }
    return entry;
  }

  /**
   * 単一プラットフォームを初期化（API用のエイリアス）
   */
  async initializePlatform(platformId) {
    // 既存のブラウザがあれば閉じる
    if (this.browsers.has(platformId)) {
      const entry = this.browsers.get(platformId);
      try {
        await entry.browser?.close();
      } catch (e) {}
      this.browsers.delete(platformId);
    }
    // 新規起動
    return await this.launchBrowser(platformId);
  }

  /**
   * ログイン実行 & セッション保存 & ブラウザ閉じてメモリ解放
   */
  async login(platformId, performLoginFn) {
    const entry = await this.getBrowser(platformId);
    if (!entry) return false;

    if (entry.loggedIn) {
      console.log(`[BrowserPool] ${platformId}: 既にログイン済み`);
      // ログイン済みならブラウザを閉じてメモリ解放
      await this._closeBrowserKeepStatus(platformId);
      return true;
    }

    const { page, platform } = entry;

    try {
      // ログインページへ（domcontentloadedで十分。networkidleだとRailway環境でタイムアウトしやすい）
      await page.goto(platform.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // 既にログイン済みかチェック
      const currentUrl = page.url();
      const loginUrl = platform.loginUrl;
      const isStillOnLoginPage = currentUrl === loginUrl ||
        currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl.includes('auth') ||
        currentUrl.replace(/\/$/, '') === loginUrl.replace(/\/$/, '');

      if (!isStillOnLoginPage) {
        console.log(`[BrowserPool] ${platformId}: セッション有効、ログイン不要 (${currentUrl})`);
        entry.loggedIn = true;
        this.loggedInPlatforms.add(platformId);
        // セッション再保存してブラウザ閉じる
        await this._saveSessionAndClose(platformId);
        return true;
      }

      // ログイン実行
      console.log(`[BrowserPool] ${platformId}: ログイン実行中...`);
      const success = await performLoginFn(page, platformId, platform);

      if (success) {
        entry.loggedIn = true;
        this.loggedInPlatforms.add(platformId);
        // セッション保存してブラウザ閉じる（メモリ解放）
        await this._saveSessionAndClose(platformId);
      } else {
        // 失敗時もブラウザ閉じる
        await this._closeBrowserKeepStatus(platformId);
      }

      return success;

    } catch (error) {
      console.error(`[BrowserPool] ${platformId}: ログインエラー - ${error.message}`);
      // エラー時もブラウザ閉じる
      await this._closeBrowserKeepStatus(platformId);
      return false;
    }
  }

  /**
   * セッション保存してブラウザを閉じる（メモリ解放）
   */
  async _saveSessionAndClose(platformId) {
    const entry = this.browsers.get(platformId);
    if (!entry) return;

    try {
      const storageState = await entry.context.storageState();
      fs.writeFileSync(this.getSessionPath(platformId), JSON.stringify(storageState, null, 2));
      console.log(`[BrowserPool] ${platformId}: セッション保存完了`);
    } catch (e) {
      console.log(`[BrowserPool] ${platformId}: セッション保存失敗 - ${e.message}`);
    }

    try {
      await entry.browser.close();
    } catch (e) {}
    this.browsers.delete(platformId);
    console.log(`[BrowserPool] ${platformId}: ブラウザ閉じてメモリ解放`);
  }

  /**
   * ブラウザを閉じるがloggedInPlatformsは維持
   */
  async _closeBrowserKeepStatus(platformId) {
    const entry = this.browsers.get(platformId);
    if (!entry) return;
    try {
      await entry.browser.close();
    } catch (e) {}
    this.browsers.delete(platformId);
  }

  /**
   * 検索実行（ブラウザをオンデマンド起動、検索後は維持）
   */
  async search(platformId, propertyName, roomNumber, performSearchFn, options = {}) {
    const entry = await this.getBrowser(platformId);
    if (!entry) {
      return { found: false, error: `Browser not available for ${platformId}` };
    }

    if (!entry.loggedIn && !this.loggedInPlatforms.has(platformId)) {
      return { found: false, error: `Not logged in to ${platformId}` };
    }

    // loggedInPlatformsにあるがentryのフラグが立ってない場合は更新
    if (!entry.loggedIn && this.loggedInPlatforms.has(platformId)) {
      entry.loggedIn = true;
    }

    const { page } = entry;
    const { skipPreSteps = false, onStep = () => {} } = options;

    try {
      const result = await performSearchFn(page, platformId, propertyName, roomNumber, { skipPreSteps, onStep });
      return result;
    } catch (error) {
      console.error(`[BrowserPool] ${platformId}: 検索エラー - ${error.message}`);
      return { found: false, error: error.message };
    }
  }

  /**
   * スクリーンショット取得
   */
  async getScreenshot(platformId) {
    const entry = this.browsers.get(platformId);
    if (!entry || !entry.page) return null;

    try {
      const buffer = await entry.page.screenshot({ type: 'jpeg', quality: 50 });
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (e) {
      return null;
    }
  }

  /**
   * 全ブラウザのスクリーンショット取得
   */
  async getAllScreenshots() {
    const screenshots = [];
    for (const [platformId, entry] of this.browsers) {
      if (entry.page) {
        try {
          const buffer = await entry.page.screenshot({ type: 'jpeg', quality: 40 });
          screenshots.push({
            platformId,
            image: `data:image/jpeg;base64,${buffer.toString('base64')}`
          });
        } catch (e) {
          // 無視
        }
      }
    }
    return screenshots;
  }

  /**
   * マルチタブ並列検索（同一プラットフォームで複数物件を同時検索）
   */
  async searchMultipleParallel(platformId, properties, performSearchFn, options = {}) {
    const { onStep = () => {}, onResult = () => {}, maxTabs = 8 } = options;
    const entry = await this.getBrowser(platformId);

    if (!entry || (!entry.loggedIn && !this.loggedInPlatforms.has(platformId))) {
      return properties.map(p => ({
        property: p,
        found: false,
        error: `Not logged in to ${platformId}`
      }));
    }

    // loggedInフラグを同期
    if (!entry.loggedIn && this.loggedInPlatforms.has(platformId)) {
      entry.loggedIn = true;
    }

    const { context, platform } = entry;
    const platformName = platform?.name || platformId;
    const numTabs = Math.min(properties.length, maxTabs);

    console.log(`[BrowserPool] ${platformId}: ${properties.length}物件を${numTabs}タブで並列検索`);
    onStep({ platformId, message: `${platformName}で${numTabs}タブ並列検索開始...` });

    // 追加タブを作成（リソースブロック付き）
    const pages = [entry.page]; // 既存ページを含める
    for (let i = 1; i < numTabs; i++) {
      try {
        const newPage = await context.newPage();
        // リソースブロック
        await newPage.route('**/*', route => {
          const resourceType = route.request().resourceType();
          const url = route.request().url();
          if (['image', 'font', 'media'].includes(resourceType)) return route.abort();
          if (url.includes('google-analytics') || url.includes('googletagmanager')) return route.abort();
          return route.continue();
        });
        pages.push(newPage);
      } catch (e) {
        console.error(`[BrowserPool] タブ作成失敗: ${e.message}`);
      }
    }

    const results = [];
    const chunks = [];

    // 物件をタブ数で分割
    for (let i = 0; i < properties.length; i += pages.length) {
      chunks.push(properties.slice(i, i + pages.length));
    }

    // チャンクごとに並列検索
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      onStep({
        platformId,
        message: `${platformName}: ${chunkIndex * pages.length + 1}〜${chunkIndex * pages.length + chunk.length}件目を並列検索中...`
      });

      const searchPromises = chunk.map(async (prop, idx) => {
        const page = pages[idx];
        const propertyName = prop.property_name || '';
        const roomNumber = prop.room_number || '';

        try {
          // 最初のタブ以外は検索ページに移動が必要
          const skipPreSteps = (idx === 0 && chunkIndex > 0);

          const result = await performSearchFn(page, platformId, propertyName, roomNumber, {
            skipPreSteps,
            onStep: (stepData) => onStep({ ...stepData, property: prop })
          });

          return {
            property: prop,
            platformId,
            platform: platformName,
            found: result.found,
            results: result.results || [],
            error: result.error
          };
        } catch (error) {
          return {
            property: prop,
            platformId,
            found: false,
            error: error.message
          };
        }
      });

      const chunkResults = await Promise.all(searchPromises);

      // 結果を通知
      for (let idx = 0; idx < chunkResults.length; idx++) {
        const result = chunkResults[idx];
        results.push(result);

        onStep({
          platformId,
          message: `${result.property?.property_name || '物件'}の検索${result.found ? 'ヒット' : '完了'}`,
          property: result.property,
          found: result.found
        });

        onResult(result);
      }
    }

    // 追加で作成したタブを閉じる（最初のタブは残す）
    for (let i = 1; i < pages.length; i++) {
      try {
        await pages[i].close();
      } catch (e) {
        // 無視
      }
    }

    console.log(`[BrowserPool] ${platformId}: 並列検索完了 - ${results.filter(r => r.found).length}/${results.length}件ヒット`);
    return results;
  }

  /**
   * 単一ブラウザを閉じる
   */
  async closeBrowser(platformId) {
    const entry = this.browsers.get(platformId);
    if (entry) {
      try {
        await entry.browser.close();
      } catch (e) {
        // 無視
      }
      this.browsers.delete(platformId);
    }
  }

  /**
   * 全ブラウザを閉じる
   */
  async closeAll() {
    console.log(`[BrowserPool] ${this.browsers.size}個のブラウザを終了中...`);
    const closePromises = [];
    for (const [platformId, entry] of this.browsers) {
      closePromises.push(
        entry.browser.close().catch(() => {})
      );
    }
    await Promise.all(closePromises);
    this.browsers.clear();
    this.initialized = false;
    console.log('[BrowserPool] 全ブラウザ終了完了');
  }

  /**
   * アクティブなブラウザ数（実際に開いているブラウザ）
   */
  get activeCount() {
    return this.browsers.size;
  }

  /**
   * ログイン済みプラットフォーム数（ブラウザの有無に関係なく）
   */
  get loggedInCount() {
    return this.loggedInPlatforms.size;
  }

  /**
   * ステータス取得（ログイン済みプラットフォームはブラウザ閉じても表示）
   */
  getStatus() {
    const status = {};

    // ログイン済みプラットフォーム（ブラウザ開いてなくても表示）
    for (const platformId of this.loggedInPlatforms) {
      const entry = this.browsers.get(platformId);
      status[platformId] = {
        loggedIn: true,
        lastUsed: entry?.lastUsed || Date.now(),
        browserActive: !!entry
      };
    }

    // 開いているがログインしていないブラウザ
    for (const [platformId, entry] of this.browsers) {
      if (!status[platformId]) {
        status[platformId] = {
          loggedIn: entry.loggedIn,
          lastUsed: entry.lastUsed,
          browserActive: true
        };
      }
    }

    return {
      active: this.activeCount,
      loggedIn: this.loggedInCount,
      maxBrowsers: MAX_BROWSERS,
      platforms: status
    };
  }
}

// シングルトンインスタンス
const browserPool = new BrowserPool();

module.exports = {
  browserPool,
  BrowserPool,
  MAX_BROWSERS
};
