/**
 * スマートスケジューラー
 * 物件リストをプラットフォームごとにグルーピングし、
 * 効率的な物確実行順序を決定する
 *
 * ★ Notion DBを参照して管理会社→プラットフォームを特定
 */

const { getSearchStrategy, learnMapping } = require('./company-mapper');

/**
 * 物件リストをプラットフォームごとにグルーピング（async版 - Notion参照）
 * @param {Array} properties - 解析済み物件リスト
 * @returns {Promise<Object>} { known: { platformId: [properties] }, unknown: [properties] }
 */
async function groupByPlatform(properties) {
  const groups = {
    known: {},    // プラットフォームが判明している物件 { 'itandi': [...], 'ierabu': [...] }
    unknown: []   // プラットフォームが不明な物件（並列検索が必要）
  };

  // 各物件を順次処理（Notion API呼び出しがあるため）
  for (const prop of properties) {
    const managementCompany = prop.management_company;

    if (!managementCompany) {
      // 管理会社が不明 → 並列検索グループへ
      console.log(`[グルーピング] ${prop.property_name || '不明'}: 管理会社なし → 並列検索`);
      groups.unknown.push(prop);
      continue;
    }

    // ★ Notion DBを参照して検索戦略を決定
    const strategy = await getSearchStrategy(managementCompany);

    if (strategy.strategy === 'single' && strategy.platforms.length > 0) {
      // プラットフォームが特定できた
      const platform = strategy.platforms[0];
      if (!groups.known[platform]) {
        groups.known[platform] = [];
      }
      console.log(`[グルーピング] ${prop.property_name || '不明'}: ${managementCompany} → ${platform} [${strategy.source}]`);
      groups.known[platform].push({
        ...prop,
        targetPlatform: platform,
        confidence: strategy.confidence || 'high',
        source: strategy.source
      });
    } else {
      // プラットフォームが不明 → 並列検索グループへ
      console.log(`[グルーピング] ${prop.property_name || '不明'}: ${managementCompany} → 並列検索 [not_found]`);
      groups.unknown.push(prop);
    }
  }

  return groups;
}

/**
 * グルーピング結果のサマリーを生成
 * @param {Object} groups - groupByPlatformの結果
 * @returns {Object} サマリー情報
 */
function getGroupSummary(groups) {
  const knownCount = Object.values(groups.known).reduce((sum, arr) => sum + arr.length, 0);
  const unknownCount = groups.unknown.length;

  const platformBreakdown = {};
  for (const [platform, props] of Object.entries(groups.known)) {
    platformBreakdown[platform] = props.length;
  }

  return {
    total: knownCount + unknownCount,
    known: knownCount,
    unknown: unknownCount,
    platforms: platformBreakdown
  };
}

/**
 * 効率的な実行プランを生成
 * @param {Object} groups - groupByPlatformの結果
 * @returns {Array} 実行プラン
 */
function createExecutionPlan(groups) {
  const plan = [];

  // 1. プラットフォームが判明しているグループ（同一プラットフォームをまとめて実行）
  for (const [platform, properties] of Object.entries(groups.known)) {
    plan.push({
      type: 'batch',           // 同一プラットフォームでバッチ実行
      platform: platform,
      properties: properties,
      count: properties.length,
      description: `${platform}で${properties.length}件を連続検索`
    });
  }

  // 2. プラットフォームが不明なもの（各物件ごとに並列検索）
  for (const prop of groups.unknown) {
    plan.push({
      type: 'parallel',        // 全プラットフォーム並列検索
      platform: null,
      properties: [prop],
      count: 1,
      description: `${prop.property_name || '不明'}を全プラットフォームで検索`
    });
  }

  return plan;
}

/**
 * 実行プランの効率性を計算
 * @param {Array} plan - 実行プラン
 * @returns {Object} 効率性指標
 */
function calculateEfficiency(plan) {
  let totalLogins = 0;
  let totalSearches = 0;

  for (const step of plan) {
    if (step.type === 'batch') {
      totalLogins += 1;  // 1回ログインで複数検索
      totalSearches += step.count;
    } else {
      totalLogins += 13; // 全プラットフォームにログイン（最悪ケース）
      totalSearches += 1;
    }
  }

  // 効率改善率を計算（全物件を個別にログインした場合との比較）
  const naiveLogins = totalSearches;
  const savedLogins = naiveLogins - totalLogins;
  const efficiencyRate = naiveLogins > 0 ? Math.round((savedLogins / naiveLogins) * 100) : 0;

  return {
    totalLogins,
    totalSearches,
    savedLogins,
    efficiencyRate,
    description: `${efficiencyRate}%のログイン削減（${savedLogins}回節約）`
  };
}

module.exports = {
  groupByPlatform,
  getGroupSummary,
  createExecutionPlan,
  calculateEfficiency
};
