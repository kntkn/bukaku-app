/**
 * 高速並列検索エンジン
 * ブラウザプールを使用して全プラットフォーム同時検索
 */

const { browserPool, MAX_BROWSERS } = require('./browser-pool');
const { performLogin, performSearch, credentials, normalizeAdToMonths } = require('./parallel-searcher');

/**
 * 全プラットフォームで同時検索（ブラウザプール使用）
 * @param {string} propertyName - 物件名
 * @param {Object} options - オプション
 * @returns {Object} 検索結果
 */
async function fastParallelSearch(propertyName, options = {}) {
  const {
    platforms = credentials.priority.slice(0, MAX_BROWSERS),
    roomNumber = '',
    stopOnFirstHit = true,
    onStatus = () => {},
    onProgress = () => {},
    onScreenshot = null
  } = options;

  console.log(`[高速並列] 開始: "${propertyName}" (${platforms.length}プラットフォーム同時)`);
  const startTime = Date.now();

  // ブラウザプール初期化（まだなら）
  if (!browserPool.initialized) {
    onStatus('initializing', 'ブラウザプールを初期化中...');
    await browserPool.initializeAll(platforms);
  }

  // 全プラットフォームでログイン（並列）
  onStatus('logging_in', `${platforms.length}サイトに同時ログイン中...`);

  const loginResults = await Promise.allSettled(
    platforms.map(pid => browserPool.login(pid, performLogin))
  );

  const loggedInPlatforms = platforms.filter((pid, idx) =>
    loginResults[idx].status === 'fulfilled' && loginResults[idx].value === true
  );

  console.log(`[高速並列] ログイン完了: ${loggedInPlatforms.length}/${platforms.length}`);

  if (loggedInPlatforms.length === 0) {
    return {
      success: false,
      error: '全プラットフォームでログイン失敗',
      hits: [],
      misses: [],
      errors: platforms.map(pid => ({ platformId: pid, error: 'ログイン失敗' }))
    };
  }

  // スクリーンショット定期送信
  let screenshotInterval = null;
  if (onScreenshot) {
    screenshotInterval = setInterval(async () => {
      const screenshots = await browserPool.getAllScreenshots();
      if (screenshots.length > 0) {
        onScreenshot(screenshots);
      }
    }, 500);
  }

  // 全プラットフォームで同時検索
  onStatus('searching', `${loggedInPlatforms.length}サイトで同時検索中...`);

  const hits = [];
  const misses = [];
  const errors = [];
  let completedCount = 0;

  try {
    // 検索を並列実行
    const searchPromises = loggedInPlatforms.map(async (platformId) => {
      const platform = credentials.platforms[platformId];
      const platformName = platform?.name || platformId;

      try {
        const result = await browserPool.search(
          platformId,
          propertyName,
          roomNumber,
          performSearch,
          { skipPreSteps: false }
        );

        completedCount++;
        onProgress({
          completed: completedCount,
          total: loggedInPlatforms.length,
          platformId,
          found: result.found
        });

        if (result.found) {
          console.log(`[高速並列] ${platformName}: ヒット！`);
          return {
            type: 'hit',
            platformId,
            platform: platformName,
            found: true,
            results: result.results || []
          };
        } else {
          console.log(`[高速並列] ${platformName}: 該当なし`);
          return {
            type: 'miss',
            platformId,
            platform: platformName,
            found: false,
            reason: result.error || '該当物件なし'
          };
        }
      } catch (error) {
        completedCount++;
        console.error(`[高速並列] ${platformName}: エラー - ${error.message}`);
        return {
          type: 'error',
          platformId,
          platform: platformName,
          error: error.message
        };
      }
    });

    // stopOnFirstHit が true の場合、最初のヒットで終了
    if (stopOnFirstHit) {
      // Promise.race的な動作だが、全結果を収集する
      const results = await Promise.all(searchPromises);

      for (const result of results) {
        if (result.type === 'hit') {
          hits.push(result);
        } else if (result.type === 'miss') {
          misses.push(result);
        } else {
          errors.push(result);
        }
      }
    } else {
      // 全結果を待つ
      const results = await Promise.all(searchPromises);

      for (const result of results) {
        if (result.type === 'hit') {
          hits.push(result);
        } else if (result.type === 'miss') {
          misses.push(result);
        } else {
          errors.push(result);
        }
      }
    }

  } finally {
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = hits.length > 0;

  console.log(`[高速並列] 完了: ${success ? 'ヒット' : '該当なし'} (${elapsed}秒, ${hits.length}件ヒット)`);

  return {
    success,
    hits,
    misses,
    errors,
    stats: {
      totalPlatforms: platforms.length,
      loggedIn: loggedInPlatforms.length,
      searched: completedCount,
      hits: hits.length,
      elapsed: parseFloat(elapsed)
    }
  };
}

/**
 * 複数物件を高速検索（ブラウザプール使用）
 * 管理会社でグルーピング済みの物件リストを効率的に処理
 * v2: マルチタブ並列検索対応 - 同一プラットフォームへの複数物件を同時検索
 * @param {Array} properties - 物件リスト
 * @param {Object} options - オプション
 */
async function fastBatchSearch(properties, options = {}) {
  const {
    onStatus = () => {},
    onProgress = () => {},
    onResult = () => {},
    onScreenshot = null,
    onStep = () => {},  // 細かいステップ通知
    maxTabsPerPlatform = 8  // プラットフォームあたりの最大タブ数
  } = options;

  console.log(`[高速バッチ] 開始: ${properties.length}件の物件を処理（マルチタブ対応）`);
  const startTime = Date.now();

  // ブラウザプール初期化
  if (!browserPool.initialized) {
    onStatus('initializing', 'ブラウザプールを初期化中...');
    await browserPool.initializeAll();
  }

  // 全プラットフォームでログイン
  const platforms = credentials.priority.slice(0, MAX_BROWSERS);
  onStatus('logging_in', `${platforms.length}サイトに同時ログイン中...`);

  await Promise.allSettled(
    platforms.map(pid => browserPool.login(pid, performLogin))
  );

  console.log(`[高速バッチ] ログイン完了: ${browserPool.loggedInCount}/${platforms.length}`);

  // スクリーンショット定期送信
  let screenshotInterval = null;
  if (onScreenshot) {
    screenshotInterval = setInterval(async () => {
      const screenshots = await browserPool.getAllScreenshots();
      if (screenshots.length > 0) {
        onScreenshot(screenshots);
      }
    }, 500);
  }

  const results = [];
  let processedCount = 0;

  try {
    // 物件をプラットフォーム別にグループ化
    const singleTargetGroups = new Map();  // platformId → [properties]
    const parallelSearchProperties = [];   // 複数プラットフォーム検索が必要な物件

    for (const prop of properties) {
      const targetPlatforms = prop.search_strategy?.platforms || platforms;
      const isSingleTarget = prop.search_strategy?.strategy === 'single' && targetPlatforms.length === 1;

      if (isSingleTarget) {
        const platformId = targetPlatforms[0];
        if (!singleTargetGroups.has(platformId)) {
          singleTargetGroups.set(platformId, []);
        }
        singleTargetGroups.get(platformId).push(prop);
      } else {
        parallelSearchProperties.push(prop);
      }
    }

    console.log(`[高速バッチ] グループ化完了: 単一ターゲット ${singleTargetGroups.size}プラットフォーム, 並列検索 ${parallelSearchProperties.length}件`);

    // === Phase 1: 単一プラットフォーム物件を順次検索（priority順） ===
    // priority順でプラットフォームを処理（左から順に）
    const orderedPlatformIds = [
      ...credentials.priority.filter(pid => singleTargetGroups.has(pid)),
      ...[...singleTargetGroups.keys()].filter(pid => !credentials.priority.includes(pid))
    ];

    for (const platformId of orderedPlatformIds) {
      const propGroup = singleTargetGroups.get(platformId);
      const entry = browserPool.browsers.get(platformId);
      if (!entry?.loggedIn) {
        // 未ログインの場合はエラー結果を追加
        for (const prop of propGroup) {
          results.push({
            property: prop,
            platformId,
            found: false,
            error: 'プラットフォーム未ログイン',
            searchType: 'single'
          });
          processedCount++;
          onProgress({ completed: processedCount, total: properties.length, property: prop, found: false });
          onResult(results[results.length - 1]);
        }
        continue;
      }

      const platformName = entry.platform?.name || platformId;

      if (propGroup.length === 1) {
        // 1件だけなら従来の検索
        const prop = propGroup[0];
        const propertyName = prop.property_name || '不明';
        const roomNumber = prop.room_number || '';
        const searchTarget = roomNumber ? `${propertyName} (${roomNumber})` : propertyName;

        onStatus('searching', `${searchTarget} → ${platformName}で検索中`);

        const searchResult = await browserPool.search(
          platformId,
          propertyName,
          roomNumber,
          performSearch,
          {
            skipPreSteps: false,
            onStep: (stepData) => {
              onStep({
                ...stepData,
                platformId,
                stepIndex: 0,
                totalInPlatform: 1,
                property: { name: propertyName, room: roomNumber }
              });
            }
          }
        );

        const result = {
          property: prop,
          platformId,
          platform: platformName,
          found: searchResult.found,
          results: searchResult.results || [],
          searchType: 'single'
        };

        results.push(result);
        processedCount++;
        onProgress({ completed: processedCount, total: properties.length, property: prop, found: result.found });
        onResult(result);
      } else {
        // 複数件あればマルチタブ並列検索（同一プラットフォーム内は並列OK）
        const numTabs = Math.min(propGroup.length, maxTabsPerPlatform);
        let completedInPlatform = 0;
        onStatus('searching', `${platformName}で${propGroup.length}件を${numTabs}タブ並列検索中`);
        onStep({
          platformId,
          stepIndex: 0,
          totalInPlatform: propGroup.length,
          message: `${platformName}で${numTabs}タブ並列検索開始`,
          property: null
        });

        const searchResults = await browserPool.searchMultipleParallel(
          platformId,
          propGroup,
          performSearch,
          {
            maxTabs: maxTabsPerPlatform,
            onStep: (stepData) => {
              completedInPlatform++;
              onStep({
                ...stepData,
                platformId,
                stepIndex: completedInPlatform,
                totalInPlatform: propGroup.length
              });
            },
            onResult: (result) => {
              results.push({
                property: result.property,
                platformId,
                platform: platformName,
                found: result.found,
                results: result.results || [],
                error: result.error,
                searchType: 'multi-tab'
              });
              processedCount++;
              onProgress({ completed: processedCount, total: properties.length, property: result.property, found: result.found });
              onResult(results[results.length - 1]);
            }
          }
        );

        console.log(`[高速バッチ] ${platformName}: マルチタブ検索完了 - ${searchResults.filter(r => r.found).length}/${searchResults.length}件ヒット`);
      }
    }

    // === Phase 2: 複数プラットフォーム検索が必要な物件を処理 ===
    let parallelStepIndex = 0;
    const totalParallel = parallelSearchProperties.length;

    for (const prop of parallelSearchProperties) {
      const propertyName = prop.property_name || '不明';
      const roomNumber = prop.room_number || '';
      const searchTarget = roomNumber ? `${propertyName} (${roomNumber})` : propertyName;
      const targetPlatforms = prop.search_strategy?.platforms || platforms;

      onStatus('searching', `${searchTarget} → ${targetPlatforms.length}サイトで並列検索中`);

      onStep({
        platformId: 'parallel',
        platform: '並列検索',
        stepIndex: parallelStepIndex,
        totalInPlatform: totalParallel,
        message: `${searchTarget}を${targetPlatforms.length}サイトで同時検索`,
        property: { name: propertyName, room: roomNumber }
      });

      const searchPromises = targetPlatforms.map(async (pid) => {
        const entry = browserPool.browsers.get(pid);
        if (!entry?.loggedIn) {
          return { platformId: pid, found: false, error: '未ログイン' };
        }

        const result = await browserPool.search(pid, propertyName, roomNumber, performSearch, {
          onStep: (stepData) => {
            onStep({
              ...stepData,
              platformId: 'parallel',
              platform: '並列検索',
              property: { name: propertyName, room: roomNumber }
            });
          }
        });
        return {
          platformId: pid,
          platform: entry.platform.name,
          found: result.found,
          results: result.results || []
        };
      });

      const searchResults = await Promise.all(searchPromises);
      const hitResults = searchResults.filter(r => r.found);

      parallelStepIndex++;

      results.push({
        property: prop,
        found: hitResults.length > 0,
        hits: hitResults,
        misses: searchResults.filter(r => !r.found),
        platformId: hitResults.length > 0 ? hitResults[0].platformId : 'parallel',
        searchType: 'parallel'
      });

      processedCount++;
      onProgress({
        completed: processedCount,
        total: properties.length,
        property: prop,
        found: results[results.length - 1].found
      });

      onResult(results[results.length - 1]);
    }

  } finally {
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const foundCount = results.filter(r => r.found).length;

  console.log(`[高速バッチ] 完了: ${foundCount}/${results.length}件ヒット (${elapsed}秒)`);

  return {
    results,
    stats: {
      total: properties.length,
      found: foundCount,
      notFound: results.length - foundCount,
      elapsed: parseFloat(elapsed)
    }
  };
}

/**
 * ブラウザプールのステータス取得
 */
function getPoolStatus() {
  return browserPool.getStatus();
}

/**
 * ブラウザプールを終了
 */
async function shutdownPool() {
  await browserPool.closeAll();
}

module.exports = {
  fastParallelSearch,
  fastBatchSearch,
  getPoolStatus,
  shutdownPool,
  browserPool
};
