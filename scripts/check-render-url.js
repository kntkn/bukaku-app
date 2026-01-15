const { chromium } = require('playwright');

async function checkRenderUrl() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage();
  
  await page.goto('https://dashboard.render.com/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  
  // URLを表示
  console.log('ダッシュボードURL:', page.url());
  await page.screenshot({ path: 'tests/screenshots/render_deployed.png' });
  
  console.log('\n--- 30秒待機（URLを確認してください）---');
  await page.waitForTimeout(30000);
  
  await browser.close();
}

checkRenderUrl();
