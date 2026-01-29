/**
 * 管理会社・プラットフォーム対応表管理モジュール
 *
 * データソース:
 * - Notion DB: 学習データ（真実の源）
 * - ローカルJSON: 自社プラットフォーム持ち会社の固定マスタのみ
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

// Notion クライアント（環境変数から初期化）
let notionClient = null;
function getNotionClient() {
  if (!notionClient && process.env.NOTION_TOKEN) {
    notionClient = new Client({ auth: process.env.NOTION_TOKEN });
  }
  return notionClient;
}

// 同時書き込み防止用のロック（管理会社名 → Promise）
const pendingSyncMap = new Map();

const MAPPING_DB_ID = process.env.NOTION_MAPPING_DATABASE_ID || '2ed1c197-4dad-8149-a358-d07d58166746';

const MAP_FILE = path.join(__dirname, '../../data/company-platform-map.json');

// platformId → Notion選択肢名のマッピング
const PLATFORM_DISPLAY_NAMES = {
  'itandi': 'ITANDI BB',
  'ierabu': 'いえらぶBB',
  'atbb': 'ATBB',
  'essquare': 'いい物件',
  'daitoservice': '大東建託',
  'seiwa': 'セイワ',
  'ambition': 'アンビション',
  'shimadahouse': 'シマダハウス',
  'goodworks': 'グッドワークス',
  'jointproperty': 'ジョイントプロパティ',
  'jaamenity': 'JAアメニティー',
  'kintarou': '金太郎',
  'able_hosho': 'エイブル保証',
  'sumirin': '住友林業レジデンシャル',
  'tanaka_dk': '田中土建工業'
};

// Notion選択肢名 → platformIdの逆引きマッピング
const PLATFORM_ID_FROM_NAME = Object.fromEntries(
  Object.entries(PLATFORM_DISPLAY_NAMES).map(([id, name]) => [name, id])
);

/**
 * 固定マスタを読み込む（自社プラットフォーム持ち会社のみ）
 */
function loadKnownCompanies() {
  try {
    const data = fs.readFileSync(MAP_FILE, 'utf-8');
    const json = JSON.parse(data);
    return json.known_companies || {};
  } catch (error) {
    console.error('固定マスタ読み込みエラー:', error.message);
    return {};
  }
}

/**
 * Notion DBから管理会社のプラットフォームを検索
 * @param {string} companyName - 管理会社名
 * @returns {Promise<Object|null>} { platform: string, platformId: string } or null
 */
async function getPlatformFromNotion(companyName) {
  console.log(`[Notion読込] 検索開始: "${companyName}"`);

  const notion = getNotionClient();
  if (!notion) {
    console.log('[Notion読込] Notion未設定 (NOTION_TOKEN:', process.env.NOTION_TOKEN ? '設定あり' : '未設定', ')');
    return null;
  }

  try {
    // 完全一致で検索
    const exactMatch = await notion.databases.query({
      database_id: MAPPING_DB_ID,
      filter: {
        property: '管理会社名',
        title: { equals: companyName }
      }
    });

    if (exactMatch.results.length > 0) {
      const page = exactMatch.results[0];
      const platformProp = page.properties['プラットフォーム'];
      if (platformProp?.select?.name) {
        const platformName = platformProp.select.name;
        const platformId = PLATFORM_ID_FROM_NAME[platformName];
        console.log(`[Notion読込] 完全一致: ${companyName} → ${platformName} (${platformId})`);
        return { platform: platformName, platformId };
      }
    }

    // 部分一致で検索（contains）
    const partialMatch = await notion.databases.query({
      database_id: MAPPING_DB_ID,
      filter: {
        property: '管理会社名',
        title: { contains: normalizeCompanyName(companyName) }
      }
    });

    if (partialMatch.results.length > 0) {
      const page = partialMatch.results[0];
      const platformProp = page.properties['プラットフォーム'];
      if (platformProp?.select?.name) {
        const platformName = platformProp.select.name;
        const platformId = PLATFORM_ID_FROM_NAME[platformName];
        console.log(`[Notion読込] 部分一致: ${companyName} → ${platformName} (${platformId})`);
        return { platform: platformName, platformId };
      }
    }

    console.log(`[Notion読込] 該当なし: ${companyName}`);
    return null;
  } catch (err) {
    console.error('[Notion読込] エラー:', err.message);
    return null;
  }
}

/**
 * 管理会社名から推奨プラットフォームを取得
 * 検索順序: Notion → 固定マスタ（自社プラットフォーム持ち）
 * @param {string} companyName - 管理会社名
 * @returns {Promise<Object>} { platforms: string[], confidence: 'high'|'medium'|'none', source: string }
 */
async function getPlatformsForCompany(companyName) {
  // 1. まずNotionを確認（真実の源）
  const notionResult = await getPlatformFromNotion(companyName);
  if (notionResult && notionResult.platformId) {
    return {
      platforms: [notionResult.platformId],
      confidence: 'high',
      source: 'notion'
    };
  }

  // 2. Notionになければ固定マスタをチェック（自社プラットフォーム持ち会社）
  const knownCompanies = loadKnownCompanies();

  // 2a. 部分一致でチェック
  for (const [knownName, info] of Object.entries(knownCompanies)) {
    if (companyName.includes(knownName) || knownName.includes(companyName)) {
      return {
        platforms: info.platforms,
        confidence: 'high',
        source: 'local_known',
        note: info.note
      };
    }
  }

  // 2b. 正規化して再チェック
  const normalizedInput = normalizeCompanyName(companyName);
  for (const [knownName, info] of Object.entries(knownCompanies)) {
    if (normalizeCompanyName(knownName) === normalizedInput) {
      return {
        platforms: info.platforms,
        confidence: 'medium',
        source: 'local_known',
        note: info.note
      };
    }
  }

  // 3. 見つからない場合
  return {
    platforms: [],
    confidence: 'none',
    source: 'none'
  };
}

/**
 * 会社名を正規化（株式会社などを除去）
 */
function normalizeCompanyName(name) {
  return name
    .replace(/株式会社|有限会社|合同会社|㈱|㈲/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Notionに学習結果を保存（新規のみ）
 * 同時書き込み防止のためロックを使用
 * @param {string} companyName - 管理会社名
 * @param {string} platformId - ヒットしたプラットフォームID
 */
async function syncToNotion(companyName, platformId) {
  const notion = getNotionClient();
  if (!notion) {
    console.log('[学習] Notion未設定のためスキップ');
    return;
  }

  // 同じ会社名で処理中の場合は待機してスキップ
  if (pendingSyncMap.has(companyName)) {
    console.log(`[学習/Notion] ${companyName} は処理中のためスキップ`);
    try {
      await pendingSyncMap.get(companyName);
    } catch (e) {
      // 先行処理のエラーは無視
    }
    return;
  }

  // ロックを取得して処理開始
  const syncPromise = doSyncToNotion(companyName, platformId);
  pendingSyncMap.set(companyName, syncPromise);

  try {
    await syncPromise;
  } finally {
    pendingSyncMap.delete(companyName);
  }
}

/**
 * 実際のNotion同期処理（内部関数）
 * ※Notionが真実の源なので、既存レコードがある場合は更新しない
 */
async function doSyncToNotion(companyName, platformId) {
  const notion = getNotionClient();

  try {
    // 既存レコードを検索
    const existing = await notion.databases.query({
      database_id: MAPPING_DB_ID,
      filter: {
        property: '管理会社名',
        title: { equals: companyName }
      }
    });

    if (existing.results.length > 0) {
      // Notionに既存レコードがある場合は更新しない
      console.log(`[学習/Notion] スキップ: ${companyName} は既にNotionに登録済み`);
      return;
    }

    // 新規作成のみ実行
    const platformName = PLATFORM_DISPLAY_NAMES[platformId];
    const properties = {
      '管理会社名': { title: [{ text: { content: companyName } }] },
      'プラットフォーム': platformName ? { select: { name: platformName } } : { select: null }
    };

    await notion.pages.create({
      parent: { database_id: MAPPING_DB_ID },
      properties
    });
    console.log(`[学習/Notion] 新規登録: ${companyName} → ${platformName}`);
  } catch (err) {
    console.error('[学習/Notion] エラー:', err.message);
    throw err;
  }
}

/**
 * 物確結果を学習（Notionに保存）
 * @param {string} companyName - 管理会社名
 * @param {string} platformId - ヒットしたプラットフォームID
 */
function learnMapping(companyName, platformId) {
  if (!companyName || !platformId) return;

  console.log(`[学習] ${companyName} → ${platformId}`);

  // Notionに同期（非同期）- 未登録の場合のみ新規作成
  syncToNotion(companyName, platformId).catch((err) => {
    console.error('[学習] Notion同期失敗:', err.message);
  });
}

/**
 * 検索優先順位を決定
 * @param {string} companyName - 管理会社名（nullなら全プラットフォーム）
 * @returns {Promise<Object>} { strategy: 'single'|'parallel', platforms: string[], source: string }
 */
async function getSearchStrategy(companyName) {
  const { credentials } = require('./parallel-searcher');

  if (!companyName) {
    // 管理会社不明 → 全プラットフォーム並列検索
    return {
      strategy: 'parallel',
      platforms: credentials.priority,
      source: 'no_company'
    };
  }

  const result = await getPlatformsForCompany(companyName);

  if (result.confidence === 'high' && result.platforms.length > 0) {
    // 高確度で特定 → そのプラットフォームのみ
    console.log(`[戦略] ${companyName} → single (${result.platforms.join(', ')}) [${result.source}]`);
    return {
      strategy: 'single',
      platforms: result.platforms,
      source: result.source,
      confidence: result.confidence
    };
  } else if (result.confidence === 'medium' && result.platforms.length > 0) {
    // 中確度 → 推奨プラットフォームを先頭にして並列
    const others = credentials.priority.filter(p => !result.platforms.includes(p));
    console.log(`[戦略] ${companyName} → parallel (優先: ${result.platforms.join(', ')}) [${result.source}]`);
    return {
      strategy: 'parallel',
      platforms: [...result.platforms, ...others],
      source: result.source,
      confidence: result.confidence
    };
  } else {
    // 不明 → 全プラットフォーム並列
    console.log(`[戦略] ${companyName} → parallel (全検索) [not_found]`);
    return {
      strategy: 'parallel',
      platforms: credentials.priority,
      source: 'not_found'
    };
  }
}

/**
 * 統計情報を取得
 */
function getStats() {
  const knownCompanies = loadKnownCompanies();
  return {
    known_companies: Object.keys(knownCompanies).length
  };
}

module.exports = {
  getPlatformsForCompany,
  learnMapping,
  getSearchStrategy,
  getStats,
  loadKnownCompanies
};
