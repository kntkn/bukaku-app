/**
 * ITANDI単体テスト
 */

const { searchOnPlatform, credentials } = require('../server/engine/parallel-searcher');

async function main() {
  const propertyName = process.argv[2] || 'アルベルゴ御茶ノ水';

  console.log('='.repeat(60));
  console.log(`ITANDI単体テスト: "${propertyName}"`);
  console.log('='.repeat(60));
  console.log('');

  const startTime = Date.now();

  const result = await searchOnPlatform('itandi', propertyName, (platformId, status, message) => {
    const icon = status === 'found' ? '✅' :
                 status === 'not_found' ? '❌' :
                 status === 'logging_in' ? '🔐' :
                 status === 'searching' ? '🔍' : '⏳';
    console.log(`${icon} ${message}`);
  }, 0);  // 左上に配置

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
    await new Promise(() => {});  // 待機
  } else {
    console.log(`エラー: ${result.error || '該当なし'}`);
    process.exit(0);
  }
}

main().catch(error => {
  console.error('エラー:', error);
  process.exit(1);
});
