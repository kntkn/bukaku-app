/**
 * 管理会社・プラットフォーム対応表管理モジュール（高速版）
 *
 * データソース:
 * - ローカルキャッシュ: 即座にロード（優先）
 * - Notion DB: バックグラウンドで同期
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

// Notion クライアント
let notionClient = null;
function getNotionClient() {
  if (!notionClient && process.env.NOTION_TOKEN) {
    notionClient = new Client({ auth: process.env.NOTION_TOKEN });
  }
  return notionClient;
}

// 同時書き込み防止用のロック
const pendingSyncMap = new Map();

// インメモリキャッシュ（管理会社名 → { platform, platformId }）
let memoryCache = new Map();
let cacheReady = false;

const MAPPING_DB_ID = process.env.NOTION_MAPPING_DATABASE_ID || '2ed1c197-4dad-8149-a358-d07d58166746';
const MAP_FILE = path.join(__dirname, '../../data/company-platform-map.json');
const CACHE_FILE = path.join(__dirname, '../../data/notion-cache.json');

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

// Notion選択肢名 → platformIdの逆引き
const PLATFORM_ID_FROM_NAME = Object.fromEntries(
  Object.entries(PLATFORM_DISPLAY_NAMES).map(([id, name]) => [name, id])
);

/**
 * 会社名を正規化
 */
function normalizeCompanyName(name) {
  return name
    .replace(/株式会社|有限会社|合同会社|㈱|㈲/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * ローカルキャッシュファイルから即座にロード
 */
function loadLocalCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      const newCache = new Map();

      for (const [name, info] of Object.entries(data.mappings || {})) {
        newCache.set(name, info);
        const normalized = normalizeCompanyName(name);
        if (normalized !== name) {
          newCache.set(normalized, info);
        }
      }

      memoryCache = newCache;
      cacheReady = true;
      console.log(`[キャッシュ] ローカルから${newCache.size}件ロード完了`);
      return true;
    }
  } catch (err) {
    console.error('[キャッシュ] ローカルロードエラー:', err.message);
  }
  return false;
}

/**
 * ローカルキャッシュファイルに保存
 */
function saveLocalCache() {
  try {
    const mappings = {};
    for (const [name, info] of memoryCache) {
      // 正規化名は保存しない（元の名前のみ）
      if (!name.includes('株式会社') || name === normalizeCompanyName(name)) {
        mappings[name] = info;
      }
    }

    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      updated: new Date().toISOString(),
      count: Object.keys(mappings).length,
      mappings
    }, null, 2));

    console.log(`[キャッシュ] ローカルに${Object.keys(mappings).length}件保存`);
  } catch (err) {
    console.error('[キャッシュ] ローカル保存エラー:', err.message);
  }
}

/**
 * Notionから全データを取得してキャッシュ更新
 */
async function syncFromNotion() {
  const notion = getNotionClient();
  if (!notion) return false;

  console.log('[キャッシュ] Notionから同期開始...');
  const startTime = Date.now();

  try {
    const newCache = new Map();
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: MAPPING_DB_ID,
        start_cursor: startCursor,
        page_size: 100
      });

      for (const page of response.results) {
        const titleProp = page.properties['管理会社名'];
        const platformProp = page.properties['プラットフォーム'];

        if (titleProp?.title?.[0]?.plain_text && platformProp?.select?.name) {
          const companyName = titleProp.title[0].plain_text;
          const platformName = platformProp.select.name;
          const platformId = PLATFORM_ID_FROM_NAME[platformName];

          newCache.set(companyName, { platform: platformName, platformId });
          const normalized = normalizeCompanyName(companyName);
          if (normalized !== companyName) {
            newCache.set(normalized, { platform: platformName, platformId });
          }
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    memoryCache = newCache;
    cacheReady = true;

    // ローカルにも保存
    saveLocalCache();

    console.log(`[キャッシュ] Notion同期完了: ${newCache.size}件 (${Date.now() - startTime}ms)`);
    return true;
  } catch (err) {
    console.error('[キャッシュ] Notion同期エラー:', err.message);
    return false;
  }
}

/**
 * 固定マスタを読み込む
 */
function loadKnownCompanies() {
  try {
    const data = fs.readFileSync(MAP_FILE, 'utf-8');
    const json = JSON.parse(data);
    return json.known_companies || {};
  } catch (error) {
    return {};
  }
}

// 固定マスタをメモリにキャッシュ
let knownCompaniesCache = null;
function getKnownCompanies() {
  if (!knownCompaniesCache) {
    knownCompaniesCache = loadKnownCompanies();
  }
  return knownCompaniesCache;
}

/**
 * キャッシュからプラットフォームを検索（同期的・高速）
 */
function getPlatformFromCache(companyName) {
  // 完全一致
  if (memoryCache.has(companyName)) {
    return memoryCache.get(companyName);
  }

  // 正規化一致
  const normalized = normalizeCompanyName(companyName);
  if (memoryCache.has(normalized)) {
    return memoryCache.get(normalized);
  }

  // 部分一致（キャッシュ内を走査）
  for (const [cachedName, result] of memoryCache) {
    if (cachedName.includes(normalized) || normalized.includes(cachedName)) {
      return result;
    }
  }

  return null;
}

/**
 * 管理会社名から推奨プラットフォームを取得（同期的・高速）
 */
function getPlatformsForCompanySync(companyName) {
  // 1. キャッシュから検索
  const cached = getPlatformFromCache(companyName);
  if (cached && cached.platformId) {
    return {
      platforms: [cached.platformId],
      confidence: 'high',
      source: 'cache'
    };
  }

  // 2. 固定マスタから検索
  const knownCompanies = getKnownCompanies();
  const normalizedInput = normalizeCompanyName(companyName);

  for (const [knownName, info] of Object.entries(knownCompanies)) {
    if (companyName.includes(knownName) || knownName.includes(companyName)) {
      return {
        platforms: info.platforms,
        confidence: 'high',
        source: 'local_known',
        note: info.note
      };
    }
    if (normalizeCompanyName(knownName) === normalizedInput) {
      return {
        platforms: info.platforms,
        confidence: 'medium',
        source: 'local_known',
        note: info.note
      };
    }
  }

  return {
    platforms: [],
    confidence: 'none',
    source: 'none'
  };
}

/**
 * 管理会社名から推奨プラットフォームを取得（互換性維持）
 */
async function getPlatformsForCompany(companyName) {
  return getPlatformsForCompanySync(companyName);
}

/**
 * Notionに学習結果を保存
 */
async function syncToNotion(companyName, platformId) {
  const notion = getNotionClient();
  if (!notion) return;

  if (pendingSyncMap.has(companyName)) {
    try { await pendingSyncMap.get(companyName); } catch {}
    return;
  }

  const syncPromise = (async () => {
    try {
      const existing = await notion.databases.query({
        database_id: MAPPING_DB_ID,
        filter: { property: '管理会社名', title: { equals: companyName } }
      });

      if (existing.results.length > 0) return;

      const platformName = PLATFORM_DISPLAY_NAMES[platformId];
      await notion.pages.create({
        parent: { database_id: MAPPING_DB_ID },
        properties: {
          '管理会社名': { title: [{ text: { content: companyName } }] },
          'プラットフォーム': platformName ? { select: { name: platformName } } : { select: null }
        }
      });

      // メモリキャッシュにも追加
      memoryCache.set(companyName, { platform: platformName, platformId });
      memoryCache.set(normalizeCompanyName(companyName), { platform: platformName, platformId });

      console.log(`[学習] 新規登録: ${companyName} → ${platformName}`);
    } catch (err) {
      console.error('[学習] エラー:', err.message);
    }
  })();

  pendingSyncMap.set(companyName, syncPromise);
  try { await syncPromise; } finally { pendingSyncMap.delete(companyName); }
}

/**
 * 物確結果を学習
 */
function learnMapping(companyName, platformId) {
  if (!companyName || !platformId) return;
  syncToNotion(companyName, platformId).catch(() => {});
}

/**
 * 検索戦略を決定（同期的・高速）
 */
function getSearchStrategySync(companyName) {
  const { credentials } = require('./parallel-searcher');

  if (!companyName) {
    return {
      strategy: 'parallel',
      platforms: credentials.priority,
      source: 'no_company'
    };
  }

  const result = getPlatformsForCompanySync(companyName);

  if (result.confidence === 'high' && result.platforms.length > 0) {
    return {
      strategy: 'single',
      platforms: result.platforms,
      source: result.source,
      confidence: result.confidence
    };
  } else if (result.confidence === 'medium' && result.platforms.length > 0) {
    const others = credentials.priority.filter(p => !result.platforms.includes(p));
    return {
      strategy: 'parallel',
      platforms: [...result.platforms, ...others],
      source: result.source,
      confidence: result.confidence
    };
  } else {
    return {
      strategy: 'parallel',
      platforms: credentials.priority,
      source: 'not_found'
    };
  }
}

/**
 * 検索戦略を決定（互換性維持）
 */
async function getSearchStrategy(companyName) {
  return getSearchStrategySync(companyName);
}

/**
 * 統計情報を取得
 */
function getStats() {
  return {
    known_companies: Object.keys(getKnownCompanies()).length,
    cached_companies: memoryCache.size,
    cache_ready: cacheReady
  };
}

/**
 * キャッシュをプリロード（サーバー起動時に呼び出し）
 */
async function preloadNotionCache() {
  // 1. まずローカルから即座にロード
  const localLoaded = loadLocalCache();

  // 2. バックグラウンドでNotionから同期（最新化）
  if (localLoaded) {
    // ローカルロード成功 → 非同期でNotion同期
    syncFromNotion().catch(err => {
      console.error('[キャッシュ] Notion同期失敗:', err.message);
    });
  } else {
    // ローカルなし → Notionから同期を待つ
    await syncFromNotion();
  }
}

/**
 * 複数物件の戦略を一括取得（超高速）
 */
function getSearchStrategiesBatch(properties) {
  return properties.map(p => ({
    property: p,
    strategy: getSearchStrategySync(p.management_company)
  }));
}

module.exports = {
  getPlatformsForCompany,
  learnMapping,
  getSearchStrategy,
  getSearchStrategySync,
  getSearchStrategiesBatch,
  getStats,
  loadKnownCompanies,
  preloadNotionCache
};
