/**
 * マイソク解析テスト
 * 使用方法: node scripts/test-maisoku-parser.js <マイソクファイルパス>
 */

const { parseFile } = require('../server/engine/maisoku-parser');

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log('使用方法: node scripts/test-maisoku-parser.js <マイソクファイルパス>');
    console.log('対応形式: PDF, JPG, PNG');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('マイソク解析テスト');
  console.log('='.repeat(60));
  console.log(`ファイル: ${filePath}`);
  console.log('');
  console.log('解析中...');

  const startTime = Date.now();
  const result = await parseFile(filePath);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`完了 (${elapsed}秒)`);
  console.log('');

  if (result.success) {
    console.log('='.repeat(60));
    console.log('【抽出結果】');
    console.log('='.repeat(60));

    const data = result.data;
    console.log(`物件名: ${data.property_name || '(不明)'}`);
    console.log(`住所: ${data.address || '(不明)'}`);
    console.log(`賃料: ${data.rent || '(不明)'}`);
    console.log(`管理費: ${data.management_fee || '(不明)'}`);
    console.log(`管理会社: ${data.management_company || '(不明)'}`);
    console.log(`AD: ${data.has_ad ? `あり (${data.ad_amount || '金額不明'})` : 'なし'}`);
    console.log(`間取り: ${data.floor_plan || '(不明)'}`);
    console.log(`面積: ${data.area || '(不明)'}`);
    console.log(`築年月: ${data.built_date || '(不明)'}`);

    if (data.notes) {
      console.log(`備考: ${data.notes}`);
    }

    console.log('');
    console.log('--- 生データ ---');
    console.log(JSON.stringify(data, null, 2));

  } else {
    console.log('解析失敗:', result.error);
  }
}

main().catch(error => {
  console.error('エラー:', error);
  process.exit(1);
});
