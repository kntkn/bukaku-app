#!/usr/bin/env node
/**
 * Step 2: ステージ別E2Eテストランナー
 *
 * Usage:
 *   bun run e2e/02-test-runner.js [options]
 *
 * Options:
 *   --parse-only       PARSEステージのみ実行
 *   --resolve-only     PARSE + RESOLVEまで実行
 *   --resume           前回のrunの続きから実行
 *   --run <runId>      指定runIdをレジューム
 *   --retry-failed     失敗分のみ再テスト
 *   --retry-stage <s>  指定ステージの失敗分のみ再テスト
 *   --headed           ブラウザを表示（SEARCH時）
 *   --limit <n>        テスト件数上限
 *   --pdf-dir <path>   PDFディレクトリ（デフォルト: e2e/data/downloads）
 */

const fs = require('fs');
const path = require('path');
const { TestHarness } = require('./lib/test-harness');
const { ResultStore } = require('./lib/result-store');

const DEFAULT_PDF_DIR = path.join(__dirname, 'data/downloads');
const SCREENSHOT_DIR = path.join(__dirname, 'data/screenshots');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    parseOnly: false,
    resolveOnly: false,
    searchOnly: false,
    resume: false,
    runId: null,
    retryFailed: false,
    retryStage: null,
    headed: false,
    limit: 0,
    pdfDir: DEFAULT_PDF_DIR
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--parse-only':
        opts.parseOnly = true;
        break;
      case '--resolve-only':
        opts.resolveOnly = true;
        break;
      case '--search-only':
        opts.searchOnly = true;
        opts.resume = true;
        break;
      case '--resume':
        opts.resume = true;
        break;
      case '--run':
        opts.runId = args[++i];
        opts.resume = true;
        break;
      case '--retry-failed':
        opts.retryFailed = true;
        opts.resume = true;
        break;
      case '--retry-stage':
        opts.retryStage = args[++i];
        opts.retryFailed = true;
        opts.resume = true;
        break;
      case '--headed':
        opts.headed = true;
        break;
      case '--limit':
        opts.limit = parseInt(args[++i], 10);
        break;
      case '--pdf-dir':
        opts.pdfDir = args[++i];
        break;
    }
  }

  return opts;
}

/**
 * ダウンロード済みPDFとメタデータを読み込み
 */
function loadTestCases(pdfDir) {
  const metadataPath = path.join(pdfDir, 'metadata.json');
  let metadata = [];

  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  }

  // PDFファイルを直接スキャン（メタデータがなくてもOK）
  const pdfFiles = fs.readdirSync(pdfDir)
    .filter(f => f.endsWith('.pdf'))
    .sort();

  return pdfFiles.map((fileName, idx) => {
    const meta = metadata.find(m => m.fileName === fileName) || {};
    return {
      id: meta.reinsId || fileName.replace('.pdf', ''),
      fileName,
      filePath: path.join(pdfDir, fileName),
      meta
    };
  });
}

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('=== E2Eテストランナー ===');
  console.log(`モード: ${opts.searchOnly ? 'SEARCH only (stored results)' : opts.parseOnly ? 'PARSE only' : opts.resolveOnly ? 'PARSE+RESOLVE' : 'FULL (PARSE→RESOLVE→SEARCH)'}`);
  console.log(`PDFディレクトリ: ${opts.pdfDir}`);

  // テストケース準備
  let testCases = loadTestCases(opts.pdfDir);

  if (testCases.length === 0) {
    console.error('テストケースが見つかりません。先に01-reins-downloader.jsを実行してください。');
    process.exit(1);
  }

  // ResultStore（レジュームまたは新規）
  let runId = opts.runId;
  if (opts.resume && !runId) {
    runId = ResultStore.findLatestRun();
    if (runId) {
      console.log(`前回のrun検出: ${runId}`);
    }
  }

  const store = new ResultStore(runId);
  store.setConfig({ ...opts, totalCases: testCases.length });

  // search-onlyモード: parse/resolveが完了しているケースのみ対象
  if (opts.searchOnly) {
    const allResults = store.getAllResults();
    const searchableIds = new Set(
      allResults
        .filter(r => r.stages?.resolve && r.stages.resolve.status !== 'fail' && r.propertyName)
        .map(r => r.id)
    );
    testCases = testCases.filter(tc => searchableIds.has(tc.id));
    console.log(`SEARCH only: resolve済み ${testCases.length}件`);
  }

  // 失敗リトライモード
  if (opts.retryFailed && !opts.searchOnly) {
    const failedResults = opts.retryStage
      ? store.getFailedResults(opts.retryStage)
      : store.getFailedResults();
    const failedIds = new Set(failedResults.map(r => r.id));
    testCases = testCases.filter(tc => failedIds.has(tc.id));
    console.log(`失敗リトライ: ${testCases.length}件`);
  }

  // レジュームモード（失敗リトライでない場合）
  if (opts.resume && !opts.retryFailed && !opts.searchOnly) {
    const completedIds = opts.parseOnly
      ? store.getCompletedForStage('parse')
      : opts.resolveOnly
        ? store.getCompletedForStage('resolve')
        : store.getCompletedForStage('search');
    const before = testCases.length;
    testCases = testCases.filter(tc => !completedIds.has(tc.id));
    console.log(`レジューム: ${before - testCases.length}件スキップ、残り${testCases.length}件`);
  }

  // リミット
  if (opts.limit > 0) {
    testCases = testCases.slice(0, opts.limit);
  }

  console.log(`テスト対象: ${testCases.length}件\n`);

  // テストハーネス初期化
  const harness = new TestHarness();

  try {
    // マッピングキャッシュをプリロード
    await harness.preload();

    // 各テストケースを実行
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const progress = `[${i + 1}/${testCases.length}]`;

      console.log(`\n${progress} === ${tc.fileName} ===`);

      let property;
      let resolveResult;

      if (opts.searchOnly) {
        // search-only: 保存済みの結果を使用
        const stored = store.getResult(tc.id);
        property = {
          property_name: stored.propertyName,
          room_number: stored.roomNumber,
          management_company: stored.managementCompany,
          address: stored.address
        };
        resolveResult = stored.stages?.resolve || {};
        console.log(`${progress} STORED: ${property.property_name} (${property.management_company || '不明'}) → ${resolveResult.strategy} [${(resolveResult.platforms || []).slice(0, 3).join(', ')}]`);
      } else {
        // --- PARSE ---
        console.log(`${progress} PARSE: 解析中...`);
        const parseResult = await harness.testParse(tc.filePath);
        store.updateStage(tc.id, 'parse', parseResult);

        if (parseResult.status === 'fail') {
          console.log(`${progress} PARSE: FAIL - ${parseResult.error}`);
          continue;
        }

        property = parseResult.properties[0];
        console.log(`${progress} PARSE: PASS - ${property.property_name || '名前なし'} (${property.management_company || '管理会社不明'})`);

        // 全プロパティ情報を結果に保存
        store.addResult({
          id: tc.id,
          fileName: tc.fileName,
          propertyName: property.property_name,
          roomNumber: property.room_number,
          managementCompany: property.management_company,
          address: property.address,
          stages: store.getResult(tc.id)?.stages || {}
        });

        if (opts.parseOnly) continue;

        // --- RESOLVE ---
        console.log(`${progress} RESOLVE: マッピング中...`);
        resolveResult = harness.testResolve(property);
        store.updateStage(tc.id, 'resolve', resolveResult);

        if (resolveResult.status === 'fail') {
          console.log(`${progress} RESOLVE: FAIL - ${resolveResult.error}`);
        } else {
          console.log(`${progress} RESOLVE: PASS - ${resolveResult.strategy} [${resolveResult.platforms.slice(0, 3).join(', ')}${resolveResult.platforms.length > 3 ? '...' : ''}] (${resolveResult.confidence})`);
        }

        if (opts.resolveOnly) continue;
      }

      // --- SEARCH ---
      console.log(`${progress} SEARCH: 検索中...`);
      const searchResult = await harness.testSearch(
        property,
        resolveResult,
        {
          headed: opts.headed,
          screenshotDir: SCREENSHOT_DIR
        }
      );
      store.updateStage(tc.id, 'search', searchResult);

      if (searchResult.status === 'pass') {
        const hitPlatforms = searchResult.hits.map(h => h.platform).join(', ');
        console.log(`${progress} SEARCH: PASS - ${hitPlatforms} (${searchResult.duration}ms)`);
      } else {
        console.log(`${progress} SEARCH: FAIL - ${searchResult.error} (${searchResult.searchedPlatforms}プラットフォーム検索, ${searchResult.duration}ms)`);
      }
    }

  } catch (error) {
    console.error('\n[致命的エラー]', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await harness.shutdown();
  }

  // サマリー出力
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = store.data.summary;

  console.log('\n=== テスト結果サマリー ===');
  console.log(`Run ID: ${store.runId}`);
  console.log(`所要時間: ${elapsed}秒`);
  console.log(`合計: ${summary.total}件`);
  console.log(`  PASS: ${summary.passed}件`);
  console.log(`  FAIL: ${summary.failed}件`);
  console.log(`  未実行: ${summary.skipped}件`);
  console.log(`結果ファイル: ${store.filePath}`);

  // ステージ別サマリー
  const allResults = store.getAllResults();
  const stages = ['parse', 'resolve', 'search'];

  console.log('\n--- ステージ別 ---');
  for (const stage of stages) {
    const stageResults = allResults.filter(r => r.stages?.[stage]);
    const pass = stageResults.filter(r => r.stages[stage].status === 'pass').length;
    const fail = stageResults.filter(r => r.stages[stage].status === 'fail').length;
    const total = stageResults.length;

    if (total > 0) {
      console.log(`  ${stage.toUpperCase()}: ${pass}/${total} pass (${(pass / total * 100).toFixed(0)}%) | ${fail} fail`);
    }
  }

  console.log(`\n次のステップ: bun run e2e/03-report-analyzer.js --run ${store.runId}`);
}

main();
