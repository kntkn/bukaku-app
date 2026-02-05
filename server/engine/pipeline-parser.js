/**
 * パイプライン解析モジュール
 * PDFをページごとに並列解析し、物件発見時にコールバックを発火
 */

const Anthropic = require('@anthropic-ai/sdk');
const pLimit = require('p-limit').default;
const { splitPdfToPages, getPageCount } = require('./pdf-splitter');

const anthropic = new Anthropic();

// デフォルト設定
const DEFAULT_CONCURRENCY = 5;  // 同時解析ページ数
const MIN_REQUEST_INTERVAL = 200;  // APIリクエスト間隔（ms）

// 解析プロンプト
const PARSE_PROMPT = `あなたは不動産マイソク（物件資料）の解析専門家です。
以下は複数ページのPDFから分割された「1ページのみ」の資料です。

【絶対ルール】
- このページに直接印刷・記載されている情報のみを抽出すること
- 他のページの情報を推測・補完してはいけない
- 確信が持てない情報はnullとすること

【抽出項目】
1. 物件名（建物名）- ページ上部や中央に大きく記載されていることが多い
2. 部屋番号 - 「101」「203」などの表記
3. 所在地（住所）
4. 賃料（管理費・共益費も含めて）
5. 管理会社名 - 以下の場所を確認すること：
   - ページ下部の帯（カラーバンド）内の会社名
   - 「取引態様」「媒介」「仲介」の近くの会社名
   - ロゴマークと共に表示された会社名
   - 「TEL」「FAX」番号の横の会社名
   ※重要: このページ内に管理会社名が見当たらない場合は必ずnullにすること。推測や他ページからの補完は禁止。
6. 間取り
7. 専有面積
8. 築年月

【出力形式】
このページに物件情報がない場合は [] を返してください。
複数の物件がある場合は配列で返してください。

JSON形式で回答：
[
  {
    "property_name": "物件名",
    "room_number": "部屋番号（101など）",
    "address": "住所",
    "rent": "賃料（例: 85,000円）",
    "management_fee": "管理費・共益費",
    "management_company": "管理会社名（このページ内に見つからない場合はnull）",
    "floor_plan": "間取り（例: 1K）",
    "area": "専有面積（例: 25.5㎡）",
    "built_date": "築年月"
  }
]

情報が見つからない項目はnullを入れてください。
物件情報がないページの場合は [] を返してください。`;

/**
 * 単一ページを解析
 * @param {Buffer} pageBuffer - ページのPDF Buffer
 * @param {number} pageNumber - ページ番号
 * @returns {Promise<{pageNumber: number, properties: Array, success: boolean, error?: string}>}
 */
async function parsePageAsync(pageBuffer, pageNumber) {
  const pdfBase64 = pageBuffer.toString('base64');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text: PARSE_PROMPT
          }
        ]
      }]
    });

    const content = response.content[0].text;

    // JSONを抽出
    let jsonStr = content;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    let properties = JSON.parse(jsonStr);

    // 配列でない場合は配列に変換
    if (!Array.isArray(properties)) {
      properties = properties ? [properties] : [];
    }

    // 空の物件をフィルタリング
    properties = properties.filter(p => p && p.property_name);

    // マイソクは1ページ=1物件が原則。複数検出された場合は最初の1件を採用
    // （AIがテーブル内の情報を個別エントリとして分割してしまうケースの対策）
    if (properties.length > 1) {
      console.log(`[解析] ページ${pageNumber}: ${properties.length}件検出 → 1件に集約`);
      properties = [properties[0]];
    }

    // ページ番号を付与
    properties = properties.map(p => ({ ...p, source_page: pageNumber }));

    console.log(`[解析] ページ${pageNumber}: ${properties.length}件の物件を検出`);

    return {
      pageNumber,
      properties,
      success: true
    };

  } catch (error) {
    console.error(`[解析] ページ${pageNumber} 失敗:`, error.message);
    return {
      pageNumber,
      properties: [],
      success: false,
      error: error.message
    };
  }
}

/**
 * PDFをパイプライン解析
 * @param {Buffer} pdfBuffer - PDFファイルのBuffer
 * @param {Object} options - オプション
 * @param {number} options.concurrency - 並列度（デフォルト5）
 * @param {Function} options.onProgress - 進捗コールバック({parsed, total})
 * @param {Function} options.onPageParsed - ページ解析完了コールバック(pageNumber, result)
 * @param {Function} options.onPropertyFound - 物件発見コールバック(property)
 * @param {AbortSignal} options.signal - キャンセル用シグナル
 * @returns {Promise<{totalPages: number, properties: Array, failedPages: Array}>}
 */
async function parsePdfPipeline(pdfBuffer, options = {}) {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
    onPageParsed,
    onPropertyFound,
    signal
  } = options;

  // PDFをページごとに分割
  const { totalPages, pageBuffers } = await splitPdfToPages(pdfBuffer);

  console.log(`[パイプライン解析] ${totalPages}ページを${concurrency}並列で解析開始`);

  const limit = pLimit(concurrency);
  let parsedCount = 0;
  const allProperties = [];
  const failedPages = [];

  // レート制限用
  let lastRequestTime = 0;

  const parsePromises = pageBuffers.map(({ pageNumber, buffer }) =>
    limit(async () => {
      // キャンセルチェック
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // レート制限
      const now = Date.now();
      const wait = MIN_REQUEST_INTERVAL - (now - lastRequestTime);
      if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
      }
      lastRequestTime = Date.now();

      // 解析実行
      const result = await parsePageAsync(buffer, pageNumber);
      parsedCount++;

      // 進捗通知
      onProgress?.({ parsed: parsedCount, total: totalPages });
      onPageParsed?.(pageNumber, result);

      if (result.success && result.properties.length > 0) {
        allProperties.push(...result.properties);
        result.properties.forEach(p => onPropertyFound?.(p));
      }

      if (!result.success) {
        failedPages.push({ pageNumber, error: result.error });
      }

      return result;
    })
  );

  await Promise.all(parsePromises);

  console.log(`[パイプライン解析] 完了: ${allProperties.length}件の物件, ${failedPages.length}ページ失敗`);

  return {
    totalPages,
    properties: allProperties,
    failedPages
  };
}

/**
 * ストリーミング解析（解析開始後すぐにPromiseを返し、コールバックで結果を通知）
 * @param {Buffer} pdfBuffer - PDFファイルのBuffer
 * @param {Object} options - オプション（parsePdfPipelineと同じ）
 * @returns {{promise: Promise, getProgress: Function}}
 */
function startParsing(pdfBuffer, options = {}) {
  let parsedCount = 0;
  let totalPages = 0;

  const promise = (async () => {
    // まずページ数を取得
    totalPages = await getPageCount(pdfBuffer);
    options.onProgress?.({ parsed: 0, total: totalPages });

    // 本解析開始
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
  parsePdfPipeline,
  startParsing
};
