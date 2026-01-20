/**
 * 単一プラットフォームテスト
 * 使用方法: node scripts/test-single-platform.js <platform_id> "物件名"
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const credentialsPath = path.join(__dirname, '../data/credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));

async function testPlatform(platformId, propertyName) {
  const platform = credentials.platforms[platformId];
  if (!platform) {
    console.log('利用可能なプラットフォーム:');
    Object.keys(credentials.platforms).forEach(id => {
      console.log(`  - ${id}`);
    });
    return;
  }

  console.log(`\n=== ${platform.name} テスト ===\n`);
  console.log(`URL: ${platform.loginUrl}`);
  console.log(`物件名: ${propertyName || '(検索なし)'}\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100  // 動きを見やすくする
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    console.log('1. ログインページへ移動...');
    await page.goto(platform.loginUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log(`   現在のURL: ${page.url()}`);

    // スクリーンショットを保存
    await page.screenshot({ path: `/tmp/${platformId}_01_login_page.png` });
    console.log(`   スクリーンショット: /tmp/${platformId}_01_login_page.png`);

    console.log('\n2. ログイン試行...');
    const creds = platform.credentials;

    if (platformId === 'itandi') {
      // ITANDI専用処理
      console.log('   ITANDIログイン処理...');

      // 要素の存在確認
      const emailInput = await page.$('input#email');
      console.log(`   email input found: ${!!emailInput}`);

      if (emailInput) {
        const isVisible = await emailInput.isVisible();
        console.log(`   email input visible: ${isVisible}`);

        const box = await emailInput.boundingBox();
        console.log(`   bounding box: ${JSON.stringify(box)}`);

        // スクロールして表示
        await emailInput.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        await emailInput.fill(creds.email);
        console.log('   email入力完了');

        await page.fill('input#password', creds.password);
        console.log('   password入力完了');

        await page.screenshot({ path: `/tmp/${platformId}_02_before_login.png` });

        await page.click('input[type="submit"]');
        console.log('   ログインボタンクリック');

        await page.waitForTimeout(5000);
        console.log(`   現在のURL: ${page.url()}`);

        // 2回目のログイン試行が必要な場合
        if (page.url().includes('login')) {
          console.log('   2回目のログイン試行...');
          const emailInput2 = await page.$('input#email');
          if (emailInput2) {
            await emailInput2.fill(creds.email);
            await page.fill('input#password', creds.password);
            await page.click('input[type="submit"]');
            await page.waitForTimeout(5000);
          }
        }
      }

      await page.screenshot({ path: `/tmp/${platformId}_03_after_login.png` });
      console.log(`   スクリーンショット: /tmp/${platformId}_03_after_login.png`);
    }

    console.log('\n3. ログイン結果確認');
    console.log(`   最終URL: ${page.url()}`);

    const loginSuccess = !page.url().includes('login');
    console.log(`   ログイン成功: ${loginSuccess}`);

    if (propertyName && loginSuccess) {
      console.log(`\n4. 「${propertyName}」を検索...`);
      // 検索処理は後で追加
    }

    console.log('\n=== テスト完了 ===');
    console.log('ブラウザは開いたままです。確認後Ctrl+Cで終了してください。');

    // 手動確認のため待機
    await new Promise(() => {});

  } catch (error) {
    console.error('\nエラー:', error.message);
    await page.screenshot({ path: `/tmp/${platformId}_error.png` });
    console.log(`エラー時スクリーンショット: /tmp/${platformId}_error.png`);
    await browser.close();
  }
}

const platformId = process.argv[2] || 'itandi';
const propertyName = process.argv[3] || '';

testPlatform(platformId, propertyName);
