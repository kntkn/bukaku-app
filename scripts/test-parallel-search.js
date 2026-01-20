/**
 * 並列検索テストスクリプト
 * 使用方法: node scripts/test-parallel-search.js "物件名"
 */

const { parallelSearch, credentials } = require('../server/engine/parallel-searcher');

async function main() {
  const propertyName = process.argv[2];

  if (!propertyName) {
    console.log('使用方法: node scripts/test-parallel-search.js "物件名"');
    console.log('例: node scripts/test-parallel-search.js "パームス代々木"');
    console.log('\n利用可能なプラットフォーム:');
    credentials.priority.forEach((id, i) => {
      const p = credentials.platforms[id];
      console.log(`  ${i + 1}. ${p.name} (${id})`);
    });
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log(`物件名: ${propertyName}`);
  console.log(`検索プラットフォーム数: ${credentials.priority.length}`);
  console.log('='.repeat(60));
  console.log('');
  console.log('>>> 全プラットフォームでブラウザを起動します...');
  console.log('');

  const startTime = Date.now();

  const result = await parallelSearch(propertyName, {
    onStatus: (platformId, status, message) => {
      const platform = credentials.platforms[platformId];
      const icon = status === 'found' ? '✅' :
                   status === 'not_found' ? '❌' :
                   status === 'logging_in' ? '🔐' :
                   status === 'searching' ? '🔍' : '⏳';
      console.log(`${icon} [${platform?.name || platformId}] ${message}`);
    },
    onComplete: ({ hits, misses, errors }) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('');
      console.log('='.repeat(60));
      console.log(`検索完了 (${elapsed}秒)`);
      console.log('='.repeat(60));
      console.log(`✅ ヒット: ${hits.length}件`);
      console.log(`❌ 該当なし: ${misses.length}件`);
      console.log(`⚠️ エラー: ${errors.length}件`);
    }
  });

  // 結果詳細を表示
  if (result.hits.length > 0) {
    console.log('\n【ヒットしたプラットフォーム】');
    result.hits.forEach(hit => {
      console.log(`\n${hit.platform} (${hit.platformId}):`);
      hit.results?.forEach((r, i) => {
        console.log(`  [${i + 1}] ステータス: ${r.status}, AD: ${r.has_ad ? 'あり' : 'なし'}`);
      });
      // ブラウザは開いたままにする（結果確認用）
      console.log(`  → ブラウザは開いたままです。確認後手動で閉じてください。`);
    });
  } else {
    console.log('\n該当する物件は見つかりませんでした。');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('エラー:', error);
  process.exit(1);
});
