/**
 * 物確パイプライン制御モジュール
 * 解析と物確を並行して実行するパイプラインを管理
 */

const EventEmitter = require('events');
const { parsePdfPipeline } = require('./pipeline-parser');
const { getSearchStrategy } = require('./company-mapper');

/**
 * 物確パイプラインクラス
 * 解析完了した物件を順次物確に回す
 */
class BukakuPipeline extends EventEmitter {
  constructor(options = {}) {
    super();

    // 設定
    this.batchSize = options.batchSize || 1;  // 物確バッチサイズ（1=即時処理）
    this.batchWaitTime = options.batchWaitTime || 500;  // バッチ待機時間（ms）
    this.useFastSearch = options.useFastSearch || false;  // 高速検索モード

    // 状態
    this.propertyQueue = [];  // 解析済み・未物確の物件キュー
    this.isParserRunning = false;
    this.isBukakuRunning = false;

    // 統計
    this.stats = {
      totalPages: 0,
      parsedPages: 0,
      failedPages: 0,
      totalProperties: 0,
      bukakuCompleted: 0,
      bukakuFound: 0
    };

    // 中断用
    this.abortController = new AbortController();
  }

  /**
   * パイプライン開始
   * @param {Buffer} pdfBuffer - PDFファイル
   * @param {Object} searchFunctions - 物確実行関数群
   */
  async start(pdfBuffer, searchFunctions) {
    console.log(`[BukakuPipeline] パイプライン開始 (mode: ${this.useFastSearch ? 'FAST' : 'NORMAL'})`);

    this.searchFunctions = searchFunctions;
    this.isParserRunning = true;

    this.emit('pipeline_start');

    // 解析開始（非同期で実行、完了を待たない）
    this.parserPromise = this.runParser(pdfBuffer);

    if (this.useFastSearch) {
      // ★ PDF解析と並列でブラウザプール初期化・ログインを開始
      // これにより解析完了時にはログインも完了している
      this.browserWarmupPromise = this.warmupBrowserPool();

      // 高速モード: 解析完了を待ってから一括で高速バッチ検索
      await this.parserPromise;
      this.isParserRunning = false;
      this.emit('parsing_complete', {
        totalPages: this.stats.totalPages,
        totalProperties: this.stats.totalProperties,
        failedPages: this.stats.failedPages
      });

      // 全物件を高速バッチ検索
      await this.runFastBatchSearch();
    } else {
      // 通常モード: 解析と物確を並行処理
      // 少し待ってから物確ワーカーを起動（最初の数件が解析されるのを待つ）
      await new Promise(r => setTimeout(r, this.batchWaitTime));
      this.startBukakuWorker();

      // 解析完了を待つ
      await this.parserPromise;
      this.isParserRunning = false;
      this.emit('parsing_complete', {
        totalPages: this.stats.totalPages,
        totalProperties: this.stats.totalProperties,
        failedPages: this.stats.failedPages
      });

      // 物確ワーカーがキューを処理し終えるまで待つ
      await this.waitForBukakuComplete();
    }

    this.emit('pipeline_complete', this.stats);
    return this.stats;
  }

  /**
   * 検索計画を作成して通知
   */
  async createAndEmitSearchPlan(properties) {
    const { credentials } = require('./parallel-searcher');
    const groups = await this.groupByPlatform(properties);

    // プラットフォーム別のステップ配列を作成（priority順）
    const steps = [];
    let knownCount = 0;

    // 物件情報を軽量化（UI表示用に必要な情報のみ）
    const simplifyProps = (props) => props.map(p => ({
      property_name: p.property_name || '不明',
      room_number: p.room_number || ''
    }));

    // priority順で既知プラットフォームをステップとして追加
    for (const platformId of credentials.priority) {
      if (groups.known[platformId] && groups.known[platformId].length > 0) {
        steps.push({
          id: platformId,
          platform: platformId,
          count: groups.known[platformId].length,
          properties: simplifyProps(groups.known[platformId]),  // 物件リスト追加
          status: 'waiting',
          completed: 0
        });
        knownCount += groups.known[platformId].length;
      }
    }

    // priorityにないプラットフォームも追加（あれば）
    for (const [platformId, props] of Object.entries(groups.known)) {
      if (!credentials.priority.includes(platformId) && props.length > 0) {
        steps.push({
          id: platformId,
          platform: platformId,
          count: props.length,
          properties: simplifyProps(props),  // 物件リスト追加
          status: 'waiting',
          completed: 0
        });
        knownCount += props.length;
      }
    }

    // パラレル検索をステップとして追加（最後に）
    const parallelCount = groups.unknown.length;
    if (parallelCount > 0) {
      steps.push({
        id: 'parallel',
        platform: '並列検索',
        count: parallelCount,
        properties: simplifyProps(groups.unknown),  // 物件リスト追加
        status: 'waiting',
        completed: 0
      });
    }

    // 推定時間を計算（秒）
    const SECONDS_PER_KNOWN = 8;
    const SECONDS_PER_PARALLEL = 25;
    const estimatedSeconds = knownCount * SECONDS_PER_KNOWN + parallelCount * SECONDS_PER_PARALLEL;

    const plan = {
      steps,
      knownCount,
      parallelCount,
      totalProperties: properties.length,
      estimatedSeconds
    };

    console.log(`[パイプライン] 検索計画: ${steps.length}ステップ, ${properties.length}件, ETA=${estimatedSeconds}秒`);
    this.emit('search_plan', plan);
    this.searchPlan = plan;
    this.searchStartTime = Date.now();

    return groups;
  }

  /**
   * 高速バッチ検索（ブラウザプール使用）
   */
  async runFastBatchSearch() {
    if (!this.searchFunctions?.fastBatchSearch) {
      console.warn('[パイプライン] fastBatchSearch が未定義、通常モードにフォールバック');
      await this.startBukakuWorker();
      await this.waitForBukakuComplete();
      return;
    }

    const properties = [...this.propertyQueue];

    // 検索計画を即座に作成・通知（同期的・ミリ秒レベル）
    // UIが「matching platforms...」で止まらないよう、ウォームアップ待機より先に実行
    await this.createAndEmitSearchPlan(properties);
    this.propertyQueue = [];

    // ★ ブラウザウォームアップ完了を待機（解析と並列で既に開始済み）
    if (this.browserWarmupPromise) {
      await this.browserWarmupPromise;
    }

    console.log(`[パイプライン] 高速バッチ検索開始: ${properties.length}件`);

    try {
      await this.searchFunctions.fastBatchSearch(properties, {
        onStatus: (status, message) => {
          this.emit('status', { status, message });
        },
        onProgress: (progress) => {
          this.stats.bukakuCompleted = progress.completed;
          // 残り時間を計算
          const elapsed = this.searchStartTime ? (Date.now() - this.searchStartTime) / 1000 : 0;
          const remaining = properties.length > 0
            ? Math.max(0, Math.round((this.searchPlan?.estimatedSeconds || 0) * (1 - progress.completed / properties.length)))
            : 0;
          this.emit('bukaku_progress', {
            completed: progress.completed,
            total: properties.length,
            found: this.stats.bukakuFound,
            remainingSeconds: remaining
          });
        },
        onResult: (result) => {
          if (result.found) {
            this.stats.bukakuFound++;
            // 空き発見を即時通知
            this.emit('vacancy_found', {
              property: result.property,
              platformId: result.hits?.[0]?.platformId || result.platformId,
              name: result.property?.property_name || '',
              room: result.property?.room_number || ''
            });
          }
          this.emit('bukaku_result', {
            property: result.property,
            found: result.found,
            hits: result.hits,
            results: result.results,
            platformId: result.hits?.[0]?.platformId || result.platformId,
            strategy: result.searchType || 'fast'
          });
        },
        onStep: (stepData) => {
          this.emit('step_update', stepData);
        },
        onScreenshot: (screenshots) => {
          this.emit('screenshots', screenshots);
        }
      });
    } catch (error) {
      console.error('[パイプライン] 高速バッチ検索エラー:', error);
      this.emit('error', { phase: 'fast_search', error: error.message });
    }
  }

  /**
   * 解析ワーカー
   */
  async runParser(pdfBuffer) {
    try {
      const result = await parsePdfPipeline(pdfBuffer, {
        concurrency: 5,
        signal: this.abortController.signal,

        onProgress: ({ parsed, total }) => {
          this.stats.totalPages = total;
          this.stats.parsedPages = parsed;
          this.emit('parsing_progress', { parsed, total });
        },

        onPropertyFound: (property) => {
          this.addProperty(property);
        }
      });

      this.stats.failedPages = result.failedPages.length;
      return result;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[パイプライン] 解析がキャンセルされました');
      } else {
        console.error('[パイプライン] 解析エラー:', error);
        this.emit('error', { phase: 'parsing', error: error.message });
      }
      throw error;
    }
  }

  /**
   * 物件をキューに追加
   */
  addProperty(property) {
    this.propertyQueue.push(property);
    this.stats.totalProperties++;
    this.emit('property_parsed', property);
  }

  /**
   * 物確ワーカー起動
   */
  async startBukakuWorker() {
    if (this.isBukakuRunning) return;
    this.isBukakuRunning = true;

    console.log('[パイプライン] 物確ワーカー起動');

    while (this.propertyQueue.length > 0 || this.isParserRunning) {
      // キャンセルチェック
      if (this.abortController.signal.aborted) break;

      if (this.propertyQueue.length === 0) {
        // 解析中で物件がまだ来る可能性あり → 待機
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // バッチを取り出して処理
      const batch = this.extractBatch();
      await this.processBatch(batch);
    }

    this.isBukakuRunning = false;
    console.log('[パイプライン] 物確ワーカー終了');
  }

  /**
   * キューからバッチを取り出し
   * 同一管理会社の物件をまとめて取り出す最適化
   */
  extractBatch() {
    const batch = [];
    const seen = new Set();

    while (batch.length < this.batchSize && this.propertyQueue.length > 0) {
      const property = this.propertyQueue.shift();
      batch.push(property);
    }

    return batch;
  }

  /**
   * バッチ処理（グルーピング → 物確）
   */
  async processBatch(batch) {
    if (batch.length === 0) return;

    console.log(`[パイプライン] バッチ処理開始: ${batch.length}件`);

    // 管理会社ごとにグルーピング
    const groups = await this.groupByPlatform(batch);

    // known物件: バッチ検索
    for (const [platformId, properties] of Object.entries(groups.known)) {
      await this.searchKnownPlatform(platformId, properties);
    }

    // unknown物件: 並列検索
    for (const property of groups.unknown) {
      await this.searchUnknownProperty(property);
    }
  }

  /**
   * 物件をプラットフォームでグルーピング（同期版・超高速）
   */
  async groupByPlatform(properties) {
    const { getSearchStrategiesBatch } = require('./company-mapper');

    const groups = {
      known: {},  // platformId → properties[]
      unknown: []
    };

    // 一括でマッチング（同期的・ミリ秒レベル）
    const startTime = Date.now();
    const results = getSearchStrategiesBatch(properties);

    // 進捗通知（一括で完了）
    this.emit('matching_progress', {
      current: properties.length,
      total: properties.length,
      propertyName: '完了'
    });

    // グルーピング処理
    for (const { property, strategy } of results) {
      if (strategy.strategy === 'single' && strategy.platforms?.length > 0) {
        const platformId = strategy.platforms[0];
        if (!groups.known[platformId]) {
          groups.known[platformId] = [];
        }
        groups.known[platformId].push({ ...property, search_strategy: strategy });
      } else {
        groups.unknown.push({ ...property, search_strategy: strategy });
      }
    }

    console.log(`[グルーピング] ${properties.length}件を${Date.now() - startTime}msで処理`);
    return groups;
  }

  /**
   * 既知プラットフォームでの検索
   */
  async searchKnownPlatform(platformId, properties) {
    if (!this.searchFunctions?.searchMultipleOnPlatform) {
      console.warn('[パイプライン] searchMultipleOnPlatform が未定義');
      return;
    }

    try {
      await this.searchFunctions.searchMultipleOnPlatform(platformId, properties, {
        onResult: (result) => {
          this.handleBukakuResult(result, platformId, 'batch');
        },
        onScreenshot: (data) => {
          // data = { platformId, image } の形式で渡ってくる
          this.emit('screenshot', { image: data.image, platformId: data.platformId });
        }
      });
    } catch (error) {
      console.error(`[パイプライン] ${platformId}検索エラー:`, error);
      // 失敗した物件を結果に追加
      properties.forEach(p => {
        this.handleBukakuResult({
          property: p,
          found: false,
          error: error.message
        }, platformId, 'batch');
      });
    }
  }

  /**
   * 未知プラットフォームでの並列検索
   */
  async searchUnknownProperty(property) {
    if (!this.searchFunctions?.parallelSearch) {
      console.warn('[パイプライン] parallelSearch が未定義');
      return;
    }

    try {
      const result = await this.searchFunctions.parallelSearch(property.property_name, {
        managementCompany: property.management_company,
        onScreenshots: (images) => {
          this.emit('screenshots', images);
        }
      });

      this.handleBukakuResult({
        property,
        found: result.success && result.hits?.length > 0,
        hits: result.hits,
        searchType: 'parallel'
      }, result.hits?.[0]?.platformId || 'parallel', 'parallel');

    } catch (error) {
      console.error('[パイプライン] 並列検索エラー:', error);
      this.handleBukakuResult({
        property,
        found: false,
        error: error.message,
        searchType: 'parallel'
      }, 'parallel', 'parallel');
    }
  }

  /**
   * 物確結果のハンドリング
   */
  handleBukakuResult(result, platformId, strategy) {
    this.stats.bukakuCompleted++;
    if (result.found) {
      this.stats.bukakuFound++;

      // 空き発見時は即時通知
      this.emit('vacancy_found', {
        property: result.property,
        platformId,
        name: result.property?.property_name || '',
        room: result.property?.room_number || ''
      });
    }

    this.emit('bukaku_result', {
      ...result,
      platformId,
      strategy
    });

    // 残り時間も計算して送信
    const elapsed = this.searchStartTime ? (Date.now() - this.searchStartTime) / 1000 : 0;
    const remaining = this.stats.totalProperties > 0
      ? Math.max(0, Math.round((this.searchPlan?.estimatedSeconds || 0) * (1 - this.stats.bukakuCompleted / this.stats.totalProperties)))
      : 0;

    this.emit('bukaku_progress', {
      completed: this.stats.bukakuCompleted,
      total: this.stats.totalProperties,
      found: this.stats.bukakuFound,
      remainingSeconds: remaining
    });
  }

  /**
   * 物確完了を待つ
   */
  async waitForBukakuComplete() {
    while (this.isBukakuRunning) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  /**
   * ブラウザプールを事前ウォームアップ（PDF解析と並列実行）
   * これにより解析完了時にはログインも完了している
   */
  async warmupBrowserPool() {
    const { browserPool, MAX_BROWSERS } = require('./browser-pool');
    const { performLogin, credentials } = require('./parallel-searcher');

    const startTime = Date.now();
    console.log('[パイプライン] ブラウザプール ウォームアップ開始（解析と並列）');

    try {
      // ブラウザ初期化
      if (!browserPool.initialized) {
        await browserPool.initializeAll();
      }

      // 全プラットフォームでログイン（並列）
      const platforms = credentials.priority.slice(0, MAX_BROWSERS);
      await Promise.allSettled(
        platforms.map(pid => browserPool.login(pid, performLogin))
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[パイプライン] ブラウザプール ウォームアップ完了: ${browserPool.loggedInCount}/${platforms.length} ログイン (${elapsed}秒)`);
    } catch (error) {
      console.error('[パイプライン] ブラウザプール ウォームアップ失敗:', error.message);
    }
  }

  /**
   * パイプラインをキャンセル
   */
  cancel() {
    console.log('[パイプライン] キャンセル要求');
    this.abortController.abort();
    this.emit('cancelled');
  }

  /**
   * 現在の進捗を取得
   */
  getProgress() {
    return {
      parsing: {
        parsed: this.stats.parsedPages,
        total: this.stats.totalPages
      },
      bukaku: {
        completed: this.stats.bukakuCompleted,
        total: this.stats.totalProperties,
        found: this.stats.bukakuFound
      },
      isParserRunning: this.isParserRunning,
      isBukakuRunning: this.isBukakuRunning,
      queueLength: this.propertyQueue.length
    };
  }
}

module.exports = { BukakuPipeline };
