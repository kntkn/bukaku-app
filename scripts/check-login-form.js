/**
 * ログインフォームの要素を確認するスクリプト
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/credentials.json'), 'utf-8'));

async function checkLoginForm(platformId) {
  const platform = credentials.platforms[platformId];
  if (!platform) {
    console.log('Unknown platform:', platformId);
    return;
  }

  console.log(`\n=== ${platform.name} (${platformId}) ===`);
  console.log(`URL: ${platform.loginUrl}`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  try {
    await page.goto(platform.loginUrl, { waitUntil: 'networkidle', timeout: 60000 });
    console.log(`現在のURL: ${page.url()}`);

    // input要素を確認
    const inputs = await page.$$('input');
    console.log('\n【input要素】');
    for (const input of inputs) {
      const type = await input.getAttribute('type');
      const name = await input.getAttribute('name');
      const id = await input.getAttribute('id');
      const placeholder = await input.getAttribute('placeholder');
      const isVisible = await input.isVisible();
      if (type !== 'hidden') {
        console.log(`  type=${type}, name=${name}, id=${id}, placeholder="${placeholder || ''}", visible=${isVisible}`);
      }
    }

    // button要素を確認
    const buttons = await page.$$('button, input[type="submit"]');
    console.log('\n【button要素】');
    for (const btn of buttons) {
      const text = await btn.textContent();
      const type = await btn.getAttribute('type');
      const isVisible = await btn.isVisible();
      console.log(`  type=${type}, text="${text.trim()}", visible=${isVisible}`);
    }

    // スクリーンショット
    await page.screenshot({ path: `/tmp/${platformId}_login_check.png`, fullPage: true });
    console.log(`\nスクリーンショット: /tmp/${platformId}_login_check.png`);

    await page.waitForTimeout(3000);
  } catch (error) {
    console.error('エラー:', error.message);
  } finally {
    await browser.close();
  }
}

const platformId = process.argv[2] || 'ierabu';
checkLoginForm(platformId);
