/**
 * プラットフォームのログインテスト
 */
const { searchOnPlatform, credentials } = require('../server/engine/parallel-searcher');

async function main() {
  const platformId = process.argv[2] || 'ierabu';
  const propertyName = process.argv[3] || 'アルベルゴ御茶ノ水';

  const platform = credentials.platforms[platformId];
  if (!platform) {
    console.log('利用可能なプラットフォーム:');
    credentials.priority.forEach(id => {
      console.log(`  - ${id}: ${credentials.platforms[id].name}`);
    });
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log(`プラットフォーム: ${platform.name} (${platformId})`);
  console.log(`物件名: ${propertyName}`);
  console.log('='.repeat(60));
  console.log('');

  const startTime = Date.now();

  const result = await searchOnPlatform(platformId, propertyName, (pid, status, message) => {
    const icon = status === 'found' ? '✅' :
                 status === 'not_found' ? '❌' :
                 status === 'logging_in' ? '🔐' :
                 status === 'searching' ? '🔍' : '⏳';
    console.log(`${icon} ${message}`);
  }, 0);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('='.repeat(60));
  console.log(`完了 (${elapsed}秒)`);
  console.log('='.repeat(60));
  console.log(`ヒット: ${result.found}`);

  if (result.found) {
    console.log('\n【検索結果】');
    result.results?.forEach((r, i) => {
      console.log(`[${i + 1}] ステータス: ${r.status}, AD: ${r.has_ad ? 'あり' : 'なし'}`);
      console.log(`    詳細: ${r.raw_text?.substring(0, 100)}...`);
    });
    console.log('\nブラウザは開いたままです。確認後Ctrl+Cで終了してください。');
    await new Promise(() => {});
  } else {
    console.log(`結果: ${result.error || '該当なし'}`);
    process.exit(0);
  }
}

main().catch(error => {
  console.error('エラー:', error);
  process.exit(1);
});
