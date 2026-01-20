/**
 * 管理会社・プラットフォーム対応表管理モジュール
 * 物確でヒットした実績を学習して対応表を更新
 * ローカルJSONとNotion DBの両方に保存
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

const MAPPING_DB_ID = process.env.NOTION_MAPPING_DATABASE_ID || '2ed1c197-4dad-8149-a358-d07d58166746';

const MAP_FILE = path.join(__dirname, '../../data/company-platform-map.json');

/**
 * 対応表を読み込む
 */
function loadMap() {
  try {
    const data = fs.readFileSync(MAP_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('対応表読み込みエラー:', error.message);
    return {
      mappings: {},
      known_companies: {}
    };
  }
}

/**
 * 対応表を保存
 */
function saveMap(mapData) {
  mapData.updated_at = new Date().toISOString();
  fs.writeFileSync(MAP_FILE, JSON.stringify(mapData, null, 2), 'utf-8');
}

/**
 * 管理会社名から推奨プラットフォームを取得
 * @param {string} companyName - 管理会社名
 * @returns {Object} { platforms: string[], confidence: 'high'|'medium'|'low'|'none' }
 */
function getPlatformsForCompany(companyName) {
  const map = loadMap();

  // 1. 既知の会社（自社プラットフォーム持ち）をチェック
  for (const [knownName, info] of Object.entries(map.known_companies)) {
    if (companyName.includes(knownName) || knownName.includes(companyName)) {
      return {
        platforms: info.platforms,
        confidence: 'high',
        note: info.note
      };
    }
  }

  // 2. 学習済みマッピングをチェック
  for (const [mappedName, info] of Object.entries(map.mappings)) {
    if (companyName.includes(mappedName) || mappedName.includes(companyName)) {
      return {
        platforms: info.platforms,
        confidence: info.hit_count >= 3 ? 'high' : 'medium',
        hit_count: info.hit_count,
        last_hit: info.last_hit
      };
    }
  }

  // 3. 部分一致で探す（より緩い条件）
  const normalizedInput = normalizeCompanyName(companyName);

  for (const [knownName, info] of Object.entries(map.known_companies)) {
    if (normalizeCompanyName(knownName) === normalizedInput) {
      return {
        platforms: info.platforms,
        confidence: 'medium',
        note: info.note
      };
    }
  }

  // 4. 見つからない場合
  return {
    platforms: [],
    confidence: 'none'
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
 * Notionに対応表を同期（upsert）
 */
async function syncToNotion(companyName, platforms, hitCount) {
  const notion = getNotionClient();
  if (!notion) {
    console.log('[学習] Notion未設定のためスキップ');
    return;
  }

  try {
    // 既存レコードを検索
    const existing = await notion.databases.query({
      database_id: MAPPING_DB_ID,
      filter: {
        property: '管理会社名',
        title: { equals: companyName }
      }
    });

    const today = new Date().toISOString().split('T')[0];
    const properties = {
      '管理会社名': { title: [{ text: { content: companyName } }] },
      'プラットフォーム': { rich_text: [{ text: { content: platforms.join(', ') } }] },
      '確認回数': { number: hitCount },
      '最終確認日': { date: { start: today } }
    };

    if (existing.results.length > 0) {
      // 更新
      await notion.pages.update({
        page_id: existing.results[0].id,
        properties
      });
      console.log(`[学習/Notion] 更新: ${companyName}`);
    } else {
      // 新規作成
      await notion.pages.create({
        parent: { database_id: MAPPING_DB_ID },
        properties
      });
      console.log(`[学習/Notion] 新規: ${companyName}`);
    }
  } catch (err) {
    console.error('[学習/Notion] エラー:', err.message);
  }
}

/**
 * 物確結果を学習して対応表を更新
 * @param {string} companyName - 管理会社名
 * @param {string} platformId - ヒットしたプラットフォームID
 */
function learnMapping(companyName, platformId) {
  if (!companyName || !platformId) return;

  const map = loadMap();
  const today = new Date().toISOString().split('T')[0];

  if (!map.mappings[companyName]) {
    map.mappings[companyName] = {
      platforms: [platformId],
      hit_count: 1,
      last_hit: today
    };
  } else {
    const existing = map.mappings[companyName];

    // プラットフォームを追加（重複なし）
    if (!existing.platforms.includes(platformId)) {
      existing.platforms.push(platformId);
    }

    existing.hit_count++;
    existing.last_hit = today;
  }

  saveMap(map);

  // Notionにも同期（非同期）
  const mapping = map.mappings[companyName];
  syncToNotion(companyName, mapping.platforms, mapping.hit_count).catch(() => {});

  console.log(`[学習] ${companyName} → ${platformId} (累計: ${mapping.hit_count}回)`);
}

/**
 * 検索優先順位を決定
 * @param {string} companyName - 管理会社名（nullなら全プラットフォーム）
 * @returns {Object} { strategy: 'single'|'parallel', platforms: string[] }
 */
function getSearchStrategy(companyName) {
  const { parallelSearch, credentials } = require('./parallel-searcher');

  if (!companyName) {
    // 管理会社不明 → 全プラットフォーム並列検索
    return {
      strategy: 'parallel',
      platforms: credentials.priority
    };
  }

  const result = getPlatformsForCompany(companyName);

  if (result.confidence === 'high' && result.platforms.length > 0) {
    // 高確度で特定 → そのプラットフォームのみ
    return {
      strategy: 'single',
      platforms: result.platforms
    };
  } else if (result.confidence === 'medium' && result.platforms.length > 0) {
    // 中確度 → 推奨プラットフォームを先頭にして並列
    const others = credentials.priority.filter(p => !result.platforms.includes(p));
    return {
      strategy: 'parallel',
      platforms: [...result.platforms, ...others]
    };
  } else {
    // 不明 → 全プラットフォーム並列
    return {
      strategy: 'parallel',
      platforms: credentials.priority
    };
  }
}

/**
 * 対応表の統計情報を取得
 */
function getStats() {
  const map = loadMap();

  return {
    known_companies: Object.keys(map.known_companies).length,
    learned_mappings: Object.keys(map.mappings).length,
    total_hits: Object.values(map.mappings).reduce((sum, m) => sum + m.hit_count, 0),
    updated_at: map.updated_at
  };
}

module.exports = {
  getPlatformsForCompany,
  learnMapping,
  getSearchStrategy,
  getStats,
  loadMap,
  saveMap
};
