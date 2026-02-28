#!/usr/bin/env node
/**
 * Step 3: テスト結果分析・レポート生成
 *
 * Usage:
 *   bun run e2e/03-report-analyzer.js [options]
 *
 * Options:
 *   --run <runId>     分析するrunId（デフォルト: 最新）
 *   --compare <id>    別のrunIdと比較
 *   --json            JSON出力
 *   --companies       未登録管理会社リストを出力
 */

const fs = require('fs');
const path = require('path');
const { ResultStore } = require('./lib/result-store');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    runId: null,
    compareId: null,
    json: false,
    companies: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--run':
        opts.runId = args[++i];
        break;
      case '--compare':
        opts.compareId = args[++i];
        break;
      case '--json':
        opts.json = true;
        break;
      case '--companies':
        opts.companies = true;
        break;
    }
  }

  return opts;
}

function analyzeResults(store) {
  const results = store.getAllResults();
  const report = {
    runId: store.runId,
    totalTests: results.length,
    stages: {},
    platforms: {},
    failurePatterns: {},
    unmappedCompanies: [],
    timeline: {}
  };

  // --- ステージ別分析 ---
  for (const stage of ['parse', 'resolve', 'search']) {
    const stageResults = results.filter(r => r.stages?.[stage]);
    const pass = stageResults.filter(r => r.stages[stage].status === 'pass');
    const fail = stageResults.filter(r => r.stages[stage].status === 'fail');
    const avgDuration = stageResults.length > 0
      ? Math.round(stageResults.reduce((sum, r) => sum + (r.stages[stage].duration || 0), 0) / stageResults.length)
      : 0;

    report.stages[stage] = {
      total: stageResults.length,
      pass: pass.length,
      fail: fail.length,
      rate: stageResults.length > 0 ? (pass.length / stageResults.length * 100).toFixed(1) : '0',
      avgDuration
    };
  }

  // --- プラットフォーム別成功率 ---
  const searchResults = results.filter(r => r.stages?.search);
  const platformStats = {};

  for (const r of searchResults) {
    const search = r.stages.search;
    const hits = search.hits || [];
    const misses = search.misses || [];

    for (const hit of hits) {
      const pid = hit.platformId || hit.platform;
      if (!platformStats[pid]) platformStats[pid] = { searched: 0, found: 0 };
      platformStats[pid].searched++;
      platformStats[pid].found++;
    }

    for (const miss of misses) {
      const pid = miss.platformId || miss.platform;
      if (!platformStats[pid]) platformStats[pid] = { searched: 0, found: 0 };
      platformStats[pid].searched++;
    }
  }

  report.platforms = Object.fromEntries(
    Object.entries(platformStats)
      .sort(([, a], [, b]) => b.found - a.found)
      .map(([pid, stats]) => [pid, {
        ...stats,
        rate: stats.searched > 0 ? (stats.found / stats.searched * 100).toFixed(1) : '0'
      }])
  );

  // --- 失敗パターン分類 ---
  const patterns = {
    parse_fail: [],
    no_company: [],
    company_unmapped: [],
    login_fail: [],
    selector_fail: [],
    not_found: [],
    timeout: [],
    other: []
  };

  for (const r of results) {
    // PARSE失敗
    if (r.stages?.parse?.status === 'fail') {
      patterns.parse_fail.push({
        id: r.id,
        fileName: r.fileName,
        error: r.stages.parse.error
      });
      continue;
    }

    // RESOLVE失敗
    if (r.stages?.resolve?.status === 'fail') {
      const error = r.stages.resolve.error || '';
      if (error.includes('No management company')) {
        patterns.no_company.push({
          id: r.id,
          propertyName: r.propertyName,
          fileName: r.fileName
        });
      } else if (error.includes('not mapped')) {
        patterns.company_unmapped.push({
          id: r.id,
          propertyName: r.propertyName,
          managementCompany: r.managementCompany,
          fileName: r.fileName
        });
      }
      continue;
    }

    // SEARCH失敗
    if (r.stages?.search?.status === 'fail') {
      const error = r.stages.search.error || '';
      if (error.includes('ログイン')) {
        patterns.login_fail.push({ id: r.id, propertyName: r.propertyName, error });
      } else if (error.includes('timeout') || error.includes('Timeout')) {
        patterns.timeout.push({ id: r.id, propertyName: r.propertyName, error });
      } else if (error.includes('not found')) {
        patterns.not_found.push({ id: r.id, propertyName: r.propertyName });
      } else {
        patterns.other.push({ id: r.id, propertyName: r.propertyName, error });
      }
    }
  }

  report.failurePatterns = Object.fromEntries(
    Object.entries(patterns)
      .filter(([, arr]) => arr.length > 0)
      .map(([key, arr]) => [key, { count: arr.length, items: arr }])
  );

  // --- 未登録管理会社リスト ---
  const unmapped = new Map();
  for (const r of results) {
    if (r.stages?.resolve?.status === 'fail' && r.managementCompany) {
      const company = r.managementCompany;
      if (!unmapped.has(company)) {
        unmapped.set(company, { company, count: 0, properties: [] });
      }
      unmapped.get(company).count++;
      unmapped.get(company).properties.push(r.propertyName || r.id);
    }
  }

  report.unmappedCompanies = [...unmapped.values()]
    .sort((a, b) => b.count - a.count);

  return report;
}

function compareRuns(report1, report2) {
  const diff = {
    run1: report1.runId,
    run2: report2.runId,
    stages: {}
  };

  for (const stage of ['parse', 'resolve', 'search']) {
    const s1 = report1.stages[stage] || { pass: 0, total: 0 };
    const s2 = report2.stages[stage] || { pass: 0, total: 0 };

    diff.stages[stage] = {
      before: `${s1.pass}/${s1.total} (${s1.rate || 0}%)`,
      after: `${s2.pass}/${s2.total} (${s2.rate || 0}%)`,
      delta: s2.pass - s1.pass,
      improved: s2.pass > s1.pass
    };
  }

  return diff;
}

function printReport(report) {
  console.log('=== E2Eテスト分析レポート ===');
  console.log(`Run: ${report.runId}`);
  console.log(`総テスト数: ${report.totalTests}`);

  // ステージ別
  console.log('\n--- ステージ別成功率 ---');
  for (const [stage, stats] of Object.entries(report.stages)) {
    const bar = makeBar(parseFloat(stats.rate));
    console.log(`  ${stage.toUpperCase().padEnd(8)} ${bar} ${stats.rate}% (${stats.pass}/${stats.total}) avg: ${stats.avgDuration}ms`);
  }

  // プラットフォーム別
  if (Object.keys(report.platforms).length > 0) {
    console.log('\n--- プラットフォーム別 ---');
    for (const [pid, stats] of Object.entries(report.platforms)) {
      console.log(`  ${pid.padEnd(18)} ${stats.found}/${stats.searched} found (${stats.rate}%)`);
    }
  }

  // 失敗パターン
  if (Object.keys(report.failurePatterns).length > 0) {
    console.log('\n--- 失敗パターン ---');
    for (const [pattern, data] of Object.entries(report.failurePatterns)) {
      console.log(`  ${pattern}: ${data.count}件`);
      // 最初の3件を表示
      for (const item of data.items.slice(0, 3)) {
        const info = item.propertyName || item.fileName || item.id;
        console.log(`    - ${info}${item.error ? ` (${item.error.slice(0, 60)})` : ''}`);
      }
      if (data.items.length > 3) {
        console.log(`    ... 他${data.items.length - 3}件`);
      }
    }
  }

  // 未登録管理会社
  if (report.unmappedCompanies.length > 0) {
    console.log('\n--- 未登録管理会社 (Notion DB追加候補) ---');
    for (const company of report.unmappedCompanies.slice(0, 20)) {
      console.log(`  ${company.company} (${company.count}件)`);
    }
    if (report.unmappedCompanies.length > 20) {
      console.log(`  ... 他${report.unmappedCompanies.length - 20}社`);
    }
  }
}

function makeBar(percent) {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

function printComparison(diff) {
  console.log('\n=== Run比較 ===');
  console.log(`${diff.run1} → ${diff.run2}`);

  for (const [stage, data] of Object.entries(diff.stages)) {
    const arrow = data.improved ? '+' : data.delta < 0 ? '' : '=';
    const symbol = data.improved ? '+' : '';
    console.log(`  ${stage.toUpperCase().padEnd(8)} ${data.before} → ${data.after} (${symbol}${data.delta})`);
  }
}

async function main() {
  const opts = parseArgs();

  // runIdを決定
  const runId = opts.runId || ResultStore.findLatestRun();
  if (!runId) {
    console.error('分析対象のrunが見つかりません。先に02-test-runner.jsを実行してください。');

    const runs = ResultStore.listRuns();
    if (runs.length > 0) {
      console.log('\n利用可能なrun:');
      for (const r of runs) {
        console.log(`  ${r}`);
      }
    }
    process.exit(1);
  }

  // 結果ロード
  const store = new ResultStore(runId);
  const report = analyzeResults(store);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);

  // 比較モード
  if (opts.compareId) {
    const compareStore = new ResultStore(opts.compareId);
    const compareReport = analyzeResults(compareStore);
    const diff = compareRuns(compareReport, report);
    printComparison(diff);
  }

  // 未登録管理会社リストのみ出力
  if (opts.companies && report.unmappedCompanies.length > 0) {
    const companiesPath = path.join(__dirname, 'data/results', `unmapped-companies-${runId}.json`);
    fs.writeFileSync(companiesPath, JSON.stringify(report.unmappedCompanies, null, 2));
    console.log(`\n未登録管理会社リスト保存: ${companiesPath}`);
  }

  // 改善アクション提案
  console.log('\n--- 推奨アクション ---');

  const failPatterns = report.failurePatterns;

  if (failPatterns.company_unmapped?.count > 0) {
    console.log(`1. Notion DBに管理会社${failPatterns.company_unmapped.count}件を追加`);
    console.log(`   → bun run e2e/03-report-analyzer.js --run ${runId} --companies`);
  }

  if (failPatterns.parse_fail?.count > 0) {
    console.log(`2. パーサー改善: ${failPatterns.parse_fail.count}件のPDF解析失敗`);
    console.log(`   → pipeline-parser.js のプロンプト/バッチ処理を確認`);
  }

  if (failPatterns.login_fail?.count > 0) {
    console.log(`3. ログイン修正: ${failPatterns.login_fail.count}件`);
    console.log(`   → platform-skills.json のloginステップを確認`);
  }

  if (failPatterns.not_found?.count > 0) {
    console.log(`4. 検索精度改善: ${failPatterns.not_found.count}件が見つからず`);
    console.log(`   → 物件名の表記ゆれ、検索クエリ最適化を検討`);
  }

  console.log(`\n修正後の再テスト: bun run e2e/02-test-runner.js --retry-failed --run ${runId}`);
}

main();
