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
    console.log('[BukakuPipeline] パイプライン開始');

    this.searchFunctions = searchFunctions;
    this.isParserRunning = true;

    this.emit('pipeline_start');

    // 解析開始（非同期で実行、完了を待たない）
    this.parserPromise = this.runParser(pdfBuffer);

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

    this.emit('pipeline_complete', this.stats);
    return this.stats;
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
   * 物件をプラットフォームでグルーピング
   */
  async groupByPlatform(properties) {
    const groups = {
      known: {},  // platformId → properties[]
      unknown: []
    };

    for (const property of properties) {
      const strategy = await getSearchStrategy(property.management_company);

      if (strategy.strategy === 'single' && strategy.platforms?.length > 0) {
        const platformId = strategy.platforms[0];
        if (!groups.known[platformId]) {
          groups.known[platformId] = [];
        }
        groups.known[platformId].push({ ...property, strategy });
      } else {
        groups.unknown.push({ ...property, strategy });
      }
    }

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
    }

    this.emit('bukaku_result', {
      ...result,
      platformId,
      strategy
    });

    this.emit('bukaku_progress', {
      completed: this.stats.bukakuCompleted,
      total: this.stats.totalProperties,
      found: this.stats.bukakuFound
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
