/**
 * パイプライン解析モジュール（Haiku + バッチ処理版）
 * PDFを高速バッチ解析し、物件発見時にコールバックを発火
 */

const Anthropic = require('@anthropic-ai/sdk');
const pLimit = require('p-limit').default;
const { splitPdfStreaming, getPageCount } = require('./pdf-splitter');

const anthropic = new Anthropic();

// 高速設定
const BATCH_SIZE = 5;           // 1回のAPI呼び出しで処理するページ数
const BATCH_CONCURRENCY = 6;    // 同時バッチ数（5×6=30ページ並列）
const MIN_REQUEST_INTERVAL = 50; // APIリクエスト間隔（ms）

// バッチ解析プロンプト（複数ページ対応）
const BATCH_PARSE_PROMPT = `あなたは不動産マイソク（物件資料）の解析専門家です。
複数ページのPDFが添付されています。各ページから物件情報を抽出してください。

【ルール】
- 各ページに記載された情報のみ抽出（推測禁止）
- 確信がない項目はnull
- 物件情報がないページは空配列

【抽出項目】
物件名、部屋番号、住所、賃料、管理費、管理会社名、間取り、専有面積、築年月

【出力形式】
ページ番号をキーにしたJSONオブジェクト:
{
  "1": [{"property_name": "...", "room_number": "...", "address": "...", "rent": "...", "management_fee": "...", "management_company": "...", "floor_plan": "...", "area": "...", "built_date": "..."}],
  "2": [],
  "3": [{"property_name": "...", ...}]
}

物件がないページは空配列[]、1ページ1物件が原則です。`;

/**
 * 複数ページをバッチ解析
 * @param {Array<{pageNumber: number, buffer: Buffer}>} pages - ページ配列
 * @returns {Promise<Array<{pageNumber: number, properties: Array, success: boolean}>>}
 */
async function parseBatchAsync(pages) {
  if (pages.length === 0) return [];

  // 各ページのPDFをBase64エンコード
  const content = [];
  const pageNumbers = [];

  for (const { pageNumber, buffer } of pages) {
    pageNumbers.push(pageNumber);
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: buffer.toString('base64')
      }
    });
  }

  // ページ番号の説明を追加
  content.push({
    type: 'text',
    text: `${BATCH_PARSE_PROMPT}\n\n添付PDFのページ番号: ${pageNumbers.join(', ')}`
  });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content
      }]
    });

    const responseText = response.content[0].text;

    // JSONを抽出
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    // 結果を各ページに分配
    const results = [];
    for (const pageNumber of pageNumbers) {
      let properties = parsed[String(pageNumber)] || parsed[pageNumber] || [];

      // 配列でない場合は配列に変換
      if (!Array.isArray(properties)) {
        properties = properties ? [properties] : [];
      }

      // 空の物件をフィルタリング
      properties = properties.filter(p => p && p.property_name);

      // 1ページ1物件に制限
      if (properties.length > 1) {
        properties = [properties[0]];
      }

      // ページ番号を付与
      properties = properties.map(p => ({ ...p, source_page: pageNumber }));

      results.push({
        pageNumber,
        properties,
        success: true
      });
    }

    console.log(`[バッチ解析] ページ${pageNumbers.join(',')} 完了: ${results.reduce((sum, r) => sum + r.properties.length, 0)}件`);
    return results;

  } catch (error) {
    console.error(`[バッチ解析] ページ${pageNumbers.join(',')} 失敗:`, error.message);

    // 失敗時は全ページをエラーとして返す
    return pageNumbers.map(pageNumber => ({
      pageNumber,
      properties: [],
      success: false,
      error: error.message
    }));
  }
}

/**
 * 単一ページを解析（フォールバック用）
 */
async function parsePageAsync(pageBuffer, pageNumber) {
  const results = await parseBatchAsync([{ pageNumber, buffer: pageBuffer }]);
  return results[0] || { pageNumber, properties: [], success: false, error: 'No result' };
}

/**
 * PDFを高速バッチ解析
 * @param {Buffer} pdfBuffer - PDFファイルのBuffer
 * @param {Object} options - オプション
 */
async function parsePdfPipeline(pdfBuffer, options = {}) {
  const {
    onProgress,
    onPageParsed,
    onPropertyFound,
    signal
  } = options;

  const startTime = Date.now();

  // ページ数を取得
  const totalPages = await getPageCount(pdfBuffer);
  console.log(`[高速解析] ${totalPages}ページをバッチ${BATCH_SIZE}×${BATCH_CONCURRENCY}並列で解析`);
  onProgress?.({ parsed: 0, total: totalPages });

  // 全ページを分割
  const allPages = [];
  await splitPdfStreaming(pdfBuffer, async ({ pageNumber, buffer }) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    allPages.push({ pageNumber, buffer });
  });

  // バッチに分割
  const batches = [];
  for (let i = 0; i < allPages.length; i += BATCH_SIZE) {
    batches.push(allPages.slice(i, i + BATCH_SIZE));
  }

  console.log(`[高速解析] ${batches.length}バッチに分割`);

  // バッチを並列処理
  const limit = pLimit(BATCH_CONCURRENCY);
  let parsedCount = 0;
  const allProperties = [];
  const failedPages = [];
  let lastRequestTime = 0;

  const batchPromises = batches.map((batch, batchIndex) =>
    limit(async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // レート制限
      const now = Date.now();
      const wait = MIN_REQUEST_INTERVAL - (now - lastRequestTime);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastRequestTime = Date.now();

      // バッチ解析
      const results = await parseBatchAsync(batch);

      // 結果を処理
      for (const result of results) {
        parsedCount++;
        onProgress?.({ parsed: parsedCount, total: totalPages });
        onPageParsed?.(result.pageNumber, result);

        if (result.success && result.properties.length > 0) {
          allProperties.push(...result.properties);
          result.properties.forEach(p => onPropertyFound?.(p));
        }

        if (!result.success) {
          failedPages.push({ pageNumber: result.pageNumber, error: result.error });
        }
      }

      return results;
    })
  );

  await Promise.all(batchPromises);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[高速解析] 完了: ${allProperties.length}件 (${elapsed}秒, ${(totalPages / elapsed).toFixed(1)}ページ/秒)`);

  return {
    totalPages,
    properties: allProperties,
    failedPages
  };
}

/**
 * ストリーミング解析インターフェース（互換性維持）
 */
function startParsing(pdfBuffer, options = {}) {
  let parsedCount = 0;
  let totalPages = 0;

  const promise = (async () => {
    totalPages = await getPageCount(pdfBuffer);
    options.onProgress?.({ parsed: 0, total: totalPages });

    return parsePdfPipeline(pdfBuffer, {
      ...options,
      onProgress: (progress) => {
        parsedCount = progress.parsed;
        options.onProgress?.(progress);
      }
    });
  })();

  return {
    promise,
    getProgress: () => ({ parsed: parsedCount, total: totalPages })
  };
}

module.exports = {
  parsePageAsync,
  parseBatchAsync,
  parsePdfPipeline,
  startParsing
};
