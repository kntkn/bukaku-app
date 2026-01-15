/**
 * ITANDI BB 物件検索の実行と結果確認
 */

const { chromium } = require('playwright');

const CREDENTIALS = {
  email: 'info@fun-t.jp',
  password: 'funt0406',
  loginUrl: 'https://itandi-accounts.com/login?client_id=itandi_bb&redirect_uri=https%3A%2F%2Fitandibb.com%2Fitandi_accounts_callback&response_type=code&state=d154b03411a94f026786ebb7ab9277ff252cbe88572cbb02261df041314b89d0'
};

async function login(page) {
  await page.goto(CREDENTIALS.loginUrl, { waitUntil: 'networkidle' });
  for (let i = 0; i < 2; i++) {
    if (page.url().includes('itandibb.com') && !page.url().includes('login')) return true;
    const emailInput = await page.$('input#email');
    if (emailInput) {
      await emailInput.fill(CREDENTIALS.email);
      await page.$('input#password').then(p => p.fill(CREDENTIALS.password));
      await page.$('input[type="submit"]').then(b => b.click());
      await page.waitForTimeout(3000);
    }
  }
  return page.url().includes('itandibb.com');
}

async function searchProperty() {
  console.log('=== ITANDI BB 物件検索実行 ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 200
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ログイン
    console.log('ログイン中...');
    if (!await login(page)) throw new Error('ログイン失敗');
    console.log('✓ ログイン成功\n');

    // 検索ページへ移動
    console.log('検索ページへ移動...');
    const listSearchButtons = await page.$$('text=リスト検索');
    if (listSearchButtons.length > 0) {
      await listSearchButtons[0].click();
      await page.waitForTimeout(2000);
    }
    console.log('  URL:', page.url());

    // 検索を実行（条件なしで全件）
    console.log('\n検索を実行（条件なし）...');
    const searchButton = await page.$('button[type="submit"]:has-text("検索")');
    if (searchButton) {
      await searchButton.click();
      await page.waitForTimeout(5000);
      console.log('✓ 検索実行完了');
    }

    console.log('  URL:', page.url());
    await page.screenshot({ path: 'tests/screenshots/search_results.png', fullPage: true });
    console.log('  スクリーンショット: search_results.png\n');

    // 検索結果の構造を調査
    console.log('=== 検索結果の構造調査 ===\n');

    // 結果件数
    const resultCount = await page.$eval('body', body => {
      const text = body.textContent;
      const match = text.match(/(\d+)件/);
      return match ? match[1] : '不明';
    });
    console.log('検索結果件数:', resultCount, '件');

    // 結果リストのアイテム構造を調査
    // 一般的なリスト要素のセレクタを試す
    const listSelectors = [
      'table tbody tr',
      '.property-item',
      '[class*="property"]',
      '[class*="result"]',
      '[class*="list-item"]',
      '[class*="card"]'
    ];

    for (const selector of listSelectors) {
      const items = await page.$$(selector);
      if (items.length > 0) {
        console.log(`\n${selector}: ${items.length}件`);
        if (items.length <= 5) {
          // 最初のアイテムの構造を確認
          const firstItemHtml = await items[0].innerHTML();
          console.log('  最初のアイテム(抜粋):', firstItemHtml.substring(0, 200));
        }
      }
    }

    // テーブルヘッダーを探す（データ構造を理解するため）
    const tableHeaders = await page.$$eval('th, [class*="header"]', els =>
      els.map(el => el.textContent.trim()).filter(t => t.length > 0 && t.length < 30)
    );
    console.log('\nテーブルヘッダー候補:');
    tableHeaders.slice(0, 15).forEach(h => console.log(`  - ${h}`));

    // 「空室」「募集」「AD」などのキーワードを含む要素を探す
    console.log('\n物確に関連する要素:');
    const keywords = ['空室', '募集', 'AD', '広告', '内見', '申込'];
    for (const kw of keywords) {
      const elements = await page.$$(`text=${kw}`);
      if (elements.length > 0) {
        console.log(`  「${kw}」: ${elements.length}件`);
      }
    }

    // 待機
    console.log('\n--- 30秒間待機中（手動で結果を確認できます）---');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/search_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

searchProperty();
