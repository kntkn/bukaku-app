/**
 * ITANDI BB 物件検索画面の探索
 */

const { chromium } = require('playwright');

const CREDENTIALS = {
  email: 'info@fun-t.jp',
  password: 'funt0406',
  loginUrl: 'https://itandi-accounts.com/login?client_id=itandi_bb&redirect_uri=https%3A%2F%2Fitandibb.com%2Fitandi_accounts_callback&response_type=code&state=d154b03411a94f026786ebb7ab9277ff252cbe88572cbb02261df041314b89d0'
};

async function login(page) {
  console.log('ログイン中...');
  await page.goto(CREDENTIALS.loginUrl, { waitUntil: 'networkidle' });

  for (let i = 0; i < 2; i++) {
    if (page.url().includes('itandibb.com') && !page.url().includes('login')) {
      return true;
    }
    await page.waitForSelector('input#email', { timeout: 5000 }).catch(() => {});
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

async function exploreSearch() {
  console.log('=== ITANDI BB 物件検索画面の探索 ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 200
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ログイン
    const loggedIn = await login(page);
    if (!loggedIn) {
      throw new Error('ログイン失敗');
    }
    console.log('✓ ログイン成功\n');

    // 「賃貸物件」→「リスト検索」へ移動
    console.log('物件検索ページへ移動中...');

    // まず「賃貸」の「リスト検索」をクリック
    const listSearchLink = await page.$('a:has-text("リスト検索")');
    if (listSearchLink) {
      await listSearchLink.click();
      await page.waitForTimeout(2000);
      console.log('✓ リスト検索ページに移動');
      console.log('  URL:', page.url());
    } else {
      // 直接URLでアクセス
      await page.goto('https://itandibb.com/rent/search', { waitUntil: 'networkidle' });
      console.log('  URL:', page.url());
    }

    await page.screenshot({ path: 'tests/screenshots/search_page.png', fullPage: true });
    console.log('  スクリーンショット: search_page.png\n');

    // 検索フォームの構造を調査
    console.log('検索フォームの構造を調査中...\n');

    // input要素
    const inputs = await page.$$eval('input', els =>
      els.map(el => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        class: el.className.substring(0, 50)
      })).filter(el => el.type !== 'hidden')
    );
    console.log('Input要素:');
    inputs.slice(0, 15).forEach((input, i) => {
      console.log(`  [${i}]`, JSON.stringify(input));
    });

    // select要素
    const selects = await page.$$eval('select', els =>
      els.map(el => ({
        name: el.name,
        id: el.id,
        class: el.className.substring(0, 30)
      }))
    );
    console.log('\nSelect要素:');
    selects.slice(0, 10).forEach((sel, i) => {
      console.log(`  [${i}]`, JSON.stringify(sel));
    });

    // 検索ボタン
    const buttons = await page.$$eval('button', els =>
      els.map(el => ({
        type: el.type,
        text: el.textContent.trim().substring(0, 30),
        class: el.className.substring(0, 30)
      }))
    );
    console.log('\nButton要素:');
    buttons.forEach((btn, i) => {
      console.log(`  [${i}]`, JSON.stringify(btn));
    });

    // 物件名や住所で検索できそうな入力欄を探す
    console.log('\n物件検索に関連する要素を探索中...');

    const searchRelated = await page.$$eval('[placeholder*="物件"], [placeholder*="住所"], [placeholder*="検索"], [name*="keyword"], [name*="search"], [name*="name"], [name*="address"]', els =>
      els.map(el => ({
        tag: el.tagName,
        name: el.name,
        placeholder: el.placeholder,
        id: el.id
      }))
    );
    console.log('物件検索関連の入力欄:');
    searchRelated.forEach((el, i) => {
      console.log(`  [${i}]`, JSON.stringify(el));
    });

    // 待機
    console.log('\n--- 20秒間待機中（手動で画面を確認できます）---');
    await page.waitForTimeout(20000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/search_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

exploreSearch();
