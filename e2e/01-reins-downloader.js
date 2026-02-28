#!/usr/bin/env node
/**
 * Step 1: REINSからマイソクPDFを一括ダウンロード
 *
 * Usage:
 *   bun run e2e/01-reins-downloader.js [options]
 *
 * Options:
 *   --count <n>    ダウンロード件数（デフォルト: 100）
 *   --headed       ブラウザを表示（デバッグ用）
 *   --resume       前回の続きからダウンロード
 */

const { ReinsNavigator, DOWNLOAD_DIR } = require('./lib/reins-navigator');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    count: 100,
    headed: false,
    resume: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':
        opts.count = parseInt(args[++i], 10);
        break;
      case '--headed':
        opts.headed = true;
        break;
      case '--resume':
        opts.resume = true;
        break;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  console.log('=== REINS マイソクダウンローダー ===');
  console.log(`目標: ${opts.count}件, headed: ${opts.headed}, resume: ${opts.resume}`);
  console.log(`保存先: ${DOWNLOAD_DIR}`);
  console.log('');

  const navigator = new ReinsNavigator({
    headed: opts.headed
  });

  try {
    await navigator.init();

    // レジューム時は既存のカウントから再開
    if (!opts.resume) {
      // 新規の場合は古いデータをクリア
      const metadataPath = path.join(DOWNLOAD_DIR, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        const backup = metadataPath.replace('.json', `-backup-${Date.now()}.json`);
        fs.renameSync(metadataPath, backup);
        console.log(`[既存データ] バックアップ: ${backup}`);
      }
      navigator.metadata = [];
      navigator.downloadCount = 0;
    }

    const startTime = Date.now();
    const metadata = await navigator.downloadMaisoku(opts.count);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pdfFiles = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.endsWith('.pdf'));

    console.log('\n=== 結果サマリー ===');
    console.log(`ダウンロード: ${metadata.length}件`);
    console.log(`PDFファイル: ${pdfFiles.length}個`);
    console.log(`所要時間: ${elapsed}秒`);
    console.log(`保存先: ${DOWNLOAD_DIR}`);

    // メタデータの品質チェック
    const withName = metadata.filter(m => m.propertyName);
    const withCompany = metadata.filter(m => m.managementCompany);
    const withAddress = metadata.filter(m => m.address);

    console.log('\n--- メタデータ品質 ---');
    console.log(`物件名あり: ${withName.length}/${metadata.length} (${(withName.length / metadata.length * 100).toFixed(0)}%)`);
    console.log(`管理会社あり: ${withCompany.length}/${metadata.length} (${(withCompany.length / metadata.length * 100).toFixed(0)}%)`);
    console.log(`住所あり: ${withAddress.length}/${metadata.length} (${(withAddress.length / metadata.length * 100).toFixed(0)}%)`);

  } catch (error) {
    console.error('\n[致命的エラー]', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await navigator.close();
  }
}

main();
