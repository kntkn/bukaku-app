/**
 * パイプライン ステージ別テストハーネス
 * 各ステージ（PARSE, RESOLVE, SEARCH）を個別に呼び出してテスト
 */

const fs = require('fs');
const path = require('path');

// エンジンモジュールへのパス解決
const ENGINE_DIR = path.join(__dirname, '../../server/engine');

const LOGIN_TIMEOUT = 45000;
const SEARCH_TIMEOUT = 45000;
const BATCH_SIZE = 4;
const MAX_PLATFORMS = 8;

class TestHarness {
  constructor() {
    this.parser = null;
    this.mapper = null;
    this.searcher = null;
    this.browserPool = null;
    this.fastSearch = null;
    this._loaded = false;
    this._browsersReady = false; // ブラウザ起動+ログイン完了フラグ
  }

  /**
   * エンジンモジュールを遅延ロード
   */
  _loadModules() {
    if (this._loaded) return;

    this.parser = require(path.join(ENGINE_DIR, 'pipeline-parser'));
    this.mapper = require(path.join(ENGINE_DIR, 'company-mapper'));
    this.searcher = require(path.join(ENGINE_DIR, 'parallel-searcher'));
    this.browserPool = require(path.join(ENGINE_DIR, 'browser-pool')).browserPool;
    this.fastSearch = require(path.join(ENGINE_DIR, 'fast-parallel-search'));

    this._loaded = true;
  }

  /**
   * PARSE ステージ: PDFを解析して物件情報を抽出
   */
  async testParse(pdfPath) {
    this._loadModules();
    const start = Date.now();

    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      const result = await this.parser.parsePdfPipeline(pdfBuffer, {});

      const properties = result.properties || [];
      const hasValidData = properties.length > 0 && properties.some(p => p.property_name);

      return {
        status: hasValidData ? 'pass' : 'fail',
        properties,
        totalPages: result.totalPages,
        failedPages: result.failedPages || [],
        duration: Date.now() - start,
        error: hasValidData ? null : 'No properties extracted'
      };
    } catch (error) {
      return {
        status: 'fail',
        properties: [],
        duration: Date.now() - start,
        error: error.message
      };
    }
  }

  /**
   * RESOLVE ステージ: 管理会社名からプラットフォームを特定
   */
  testResolve(property) {
    this._loadModules();
    const start = Date.now();

    const companyName = property.management_company;

    if (!companyName) {
      const { credentials } = this.searcher;
      return {
        status: 'warn',
        strategy: 'parallel',
        platforms: credentials.priority,
        confidence: 'none',
        source: 'no_company',
        duration: Date.now() - start,
        error: null,
        warning: 'No management company - will parallel search all platforms'
      };
    }

    try {
      const result = this.mapper.getSearchStrategySync(companyName);

      const resolved = result.strategy === 'single' ||
        (result.strategy === 'parallel' && result.source !== 'not_found' && result.source !== 'no_company');

      const isUnmapped = !resolved && result.source === 'not_found';

      return {
        status: resolved ? 'pass' : isUnmapped ? 'warn' : 'fail',
        strategy: result.strategy,
        platforms: result.platforms,
        confidence: result.confidence || 'none',
        source: result.source,
        duration: Date.now() - start,
        error: resolved ? null : `Company not mapped: ${companyName}`,
        warning: isUnmapped ? `Unmapped company "${companyName}" - will parallel search` : null
      };
    } catch (error) {
      return {
        status: 'fail',
        strategy: null,
        platforms: [],
        duration: Date.now() - start,
        error: error.message
      };
    }
  }

  /**
   * ブラウザ起動+ログイン（全プラットフォーム一括、1回だけ実行）
   * testSearch の前に呼ぶ。2回目以降はスキップ。
   */
  async ensureBrowsersReady(platformIds = null) {
    if (this._browsersReady) return;
    this._loadModules();

    const targets = platformIds || this.searcher.credentials.priority.slice(0, MAX_PLATFORMS);
    console.log(`[Harness] ブラウザ起動+ログイン: ${targets.join(', ')}`);

    // 順次起動（Playwrightの同時launch制限回避）
    for (const pid of targets) {
      if (!this.browserPool.browsers?.has(pid)) {
        await this.browserPool.launchBrowser(pid);
      }
    }

    // バッチでログイン（並列、タイムアウト付き）
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      console.log(`[Harness] ログインバッチ ${i/BATCH_SIZE + 1}: ${batch.join(', ')}`);

      const loginResults = await Promise.allSettled(
        batch.map(async (pid) => {
          const loginPromise = this.browserPool.login(pid, this.searcher.performLogin, { keepAlive: true });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Login timeout (${LOGIN_TIMEOUT/1000}s)`)), LOGIN_TIMEOUT)
          );
          return Promise.race([loginPromise, timeoutPromise]);
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const result = loginResults[j];
        if (result.status === 'rejected') {
          console.log(`[Harness] ${batch[j]}: ログイン失敗 - ${result.reason?.message || result.reason}`);
          await this.browserPool._closeBrowserKeepStatus(batch[j]).catch(() => {});
        }
      }
    }

    // ログイン後にブラウザが閉じられている場合、検索用に順次再起動
    console.log(`[Harness] 検索用ブラウザを確認・起動中...`);
    for (const pid of targets) {
      if (!this.browserPool.browsers?.has(pid)) {
        await this.browserPool.launchBrowser(pid);
      }
    }

    this.browserPool.initialized = true;
    this._browsersReady = true;
    this._launchedPlatforms = new Set(targets);
    console.log(`[Harness] ブラウザ準備完了 (active: ${this.browserPool.activeCount})`);
  }

  /**
   * 追加プラットフォームのブラウザ起動+ログイン（フォールバック用）
   */
  async _launchAndLoginPlatforms(platformIds) {
    this._loadModules();
    if (!this._launchedPlatforms) this._launchedPlatforms = new Set();

    console.log(`[Harness] フォールバック用ブラウザ起動: ${platformIds.join(', ')}`);

    for (const pid of platformIds) {
      if (!this.browserPool.browsers?.has(pid)) {
        await this.browserPool.launchBrowser(pid);
      }
    }

    for (let i = 0; i < platformIds.length; i += BATCH_SIZE) {
      const batch = platformIds.slice(i, i + BATCH_SIZE);
      const loginResults = await Promise.allSettled(
        batch.map(async (pid) => {
          const loginPromise = this.browserPool.login(pid, this.searcher.performLogin, { keepAlive: true });
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Login timeout (${LOGIN_TIMEOUT/1000}s)`)), LOGIN_TIMEOUT)
          );
          return Promise.race([loginPromise, timeoutPromise]);
        })
      );

      for (let j = 0; j < batch.length; j++) {
        if (loginResults[j].status === 'rejected') {
          console.log(`[Harness][fallback] ${batch[j]}: ログイン失敗 - ${loginResults[j].reason?.message}`);
          await this.browserPool._closeBrowserKeepStatus(batch[j]).catch(() => {});
        }
      }
    }

    for (const pid of platformIds) {
      if (!this.browserPool.browsers?.has(pid)) {
        await this.browserPool.launchBrowser(pid);
      }
      this._launchedPlatforms.add(pid);
    }
  }

  /**
   * SEARCH ステージ: プラットフォームで物件を検索
   * ensureBrowsersReady() が事前に呼ばれていること
   */
  async testSearch(property, resolveResult, options = {}) {
    this._loadModules();
    const { screenshotDir } = options;
    const start = Date.now();
    const propertyName = property.property_name;
    const roomNumber = property.room_number || '';

    if (!propertyName) {
      return {
        status: 'fail',
        found: false,
        duration: Date.now() - start,
        error: 'No property name'
      };
    }

    const platforms = resolveResult?.platforms || this.searcher.credentials.priority;
    const targetPlatforms = platforms.slice(0, MAX_PLATFORMS);

    // まだブラウザ準備ができてなければ初期化
    if (!this._browsersReady) {
      await this.ensureBrowsersReady(targetPlatforms);
    }

    try {
      // 各プラットフォームで検索（バッチ実行）
      const allResults = [];
      for (let i = 0; i < targetPlatforms.length; i += BATCH_SIZE) {
        const batch = targetPlatforms.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (platformId) => {
          try {
            const searchPromise = this.browserPool.search(
              platformId,
              propertyName,
              roomNumber,
              this.searcher.performSearch,
              { skipPreSteps: false }
            );
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Search timeout (${SEARCH_TIMEOUT/1000}s)`)), SEARCH_TIMEOUT)
            );
            const result = await Promise.race([searchPromise, timeoutPromise]);

            const entry = {
              platformId,
              platform: this.searcher.credentials.platforms[platformId]?.name || platformId,
              found: result.found,
              results: result.results || [],
              error: result.error,
              skipped: result.status === 'SKIPPED'
            };
            console.log(`[Harness] ${platformId}: ${entry.skipped ? 'SKIPPED' : entry.found ? 'FOUND' : 'NOT_FOUND'}${entry.error ? ' (' + entry.error + ')' : ''}`);
            return entry;
          } catch (error) {
            console.log(`[Harness] ${platformId}: ERROR - ${error.message}`);
            return {
              platformId,
              found: false,
              error: error.message
            };
          }
        }));
        allResults.push(...batchResults);
      }

      let hits = allResults.filter(r => r.found);

      // single戦略で全PF NOT_FOUND → 残りPFでフォールバック検索
      if (hits.length === 0 && resolveResult?.strategy === 'single') {
        const searchedIds = targetPlatforms;
        const { platformSkills: skills } = this.searcher;
        const fallbackPlatforms = this.searcher.credentials.priority.filter(id =>
          !searchedIds.includes(id) && !skills[id]?.rpaProhibited
        ).slice(0, MAX_PLATFORMS);

        if (fallbackPlatforms.length > 0) {
          console.log(`[Harness] single→parallel fallback: searching ${fallbackPlatforms.length} additional platforms`);

          // フォールバック用にブラウザを追加起動
          const newPlatforms = fallbackPlatforms.filter(id => !this._launchedPlatforms?.has(id));
          if (newPlatforms.length > 0) {
            await this._launchAndLoginPlatforms(newPlatforms);
          }

          for (let i = 0; i < fallbackPlatforms.length; i += BATCH_SIZE) {
            const batch = fallbackPlatforms.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (platformId) => {
              try {
                const searchPromise = this.browserPool.search(
                  platformId,
                  propertyName,
                  roomNumber,
                  this.searcher.performSearch,
                  { skipPreSteps: false }
                );
                const timeoutPromise = new Promise((_, reject) =>
                  setTimeout(() => reject(new Error(`Search timeout (${SEARCH_TIMEOUT/1000}s)`)), SEARCH_TIMEOUT)
                );
                const result = await Promise.race([searchPromise, timeoutPromise]);

                const entry = {
                  platformId,
                  platform: this.searcher.credentials.platforms[platformId]?.name || platformId,
                  found: result.found,
                  results: result.results || [],
                  error: result.error,
                  skipped: result.status === 'SKIPPED',
                  fallback: true
                };
                console.log(`[Harness][fallback] ${platformId}: ${entry.skipped ? 'SKIPPED' : entry.found ? 'FOUND' : 'NOT_FOUND'}`);
                return entry;
              } catch (error) {
                console.log(`[Harness][fallback] ${platformId}: ERROR - ${error.message}`);
                return { platformId, found: false, error: error.message, fallback: true };
              }
            }));
            allResults.push(...batchResults);
          }

          hits = allResults.filter(r => r.found);
        }
      }

      if (hits.length === 0 && screenshotDir) {
        await this._captureScreenshots(screenshotDir, propertyName);
      }

      return {
        status: hits.length > 0 ? 'pass' : 'fail',
        found: hits.length > 0,
        hits,
        misses: allResults.filter(r => !r.found && !r.skipped),
        skipped: allResults.filter(r => r.skipped),
        searchedPlatforms: allResults.length,
        duration: Date.now() - start,
        error: hits.length > 0 ? null : 'Property not found on any platform'
      };
    } catch (error) {
      return {
        status: 'fail',
        found: false,
        duration: Date.now() - start,
        error: error.message
      };
    }
  }

  /**
   * フルパイプラインテスト（PARSE → RESOLVE → SEARCH）
   */
  async testFull(pdfPath, options = {}) {
    const results = { parse: null, resolve: null, search: null };

    results.parse = await this.testParse(pdfPath);
    if (results.parse.status === 'fail') {
      return results;
    }

    const property = results.parse.properties.find(p => p.management_company) ||
      results.parse.properties[0];

    results.resolve = this.testResolve(property);

    if (!options.parseOnly && !options.resolveOnly) {
      results.search = await this.testSearch(property, {
        platforms: results.resolve.platforms,
        strategy: results.resolve.strategy
      }, options);
    }

    return results;
  }

  /**
   * 管理会社マッピングキャッシュをプリロード
   */
  async preload() {
    this._loadModules();
    await this.mapper.preloadNotionCache();
    console.log(`[Harness] マッピングキャッシュロード完了: ${this.mapper.getStats().cached_companies}件`);
  }

  /**
   * ブラウザプールをシャットダウン
   */
  async shutdown() {
    if (this.browserPool) {
      await this.browserPool.closeAll();
    }
  }

  async _captureScreenshots(dir, propertyName) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const screenshots = await this.browserPool.getAllScreenshots();
    for (const ss of screenshots) {
      const safeName = propertyName.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 30);
      const fileName = `${safeName}_${ss.platformId}.jpg`;
      const base64Data = ss.image.replace(/^data:image\/jpeg;base64,/, '');
      fs.writeFileSync(path.join(dir, fileName), base64Data, 'base64');
    }
  }
}

module.exports = { TestHarness };
