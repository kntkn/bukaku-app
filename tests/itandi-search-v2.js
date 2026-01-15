/**
 * ITANDI BB 物件検索画面の探索 v2
 * パス: 賃貸物件 → 居住用部屋
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
  console.log('=== ITANDI BB 物件検索（居住用賃貸）===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ログイン
    const loggedIn = await login(page);
    if (!loggedIn) throw new Error('ログイン失敗');
    console.log('✓ ログイン成功\n');

    // 「賃貸物件」メニューをホバー/クリック
    console.log('「賃貸物件」メニューを探索中...');

    // 上部メニューの「賃貸物件」をクリック
    const rentMenu = await page.$('text=賃貸物件');
    if (rentMenu) {
      await rentMenu.hover();
      await page.waitForTimeout(500);
      console.log('✓ 賃貸物件メニューをホバー');

      // スクリーンショット（ドロップダウンメニュー表示状態）
      await page.screenshot({ path: 'tests/screenshots/v2_menu_hover.png' });

      // 「居住用部屋」を探してクリック
      const roomLink = await page.$('text=居住用部屋');
      if (roomLink) {
        await roomLink.click();
        await page.waitForTimeout(2000);
        console.log('✓ 居住用部屋をクリック');
      }
    }

    console.log('  URL:', page.url());
    await page.screenshot({ path: 'tests/screenshots/v2_search_page.png', fullPage: true });
    console.log('  スクリーンショット: v2_search_page.png\n');

    // 検索フォームの構造を調査
    console.log('検索フォームの構造を調査中...');

    // テキスト入力欄
    const textInputs = await page.$$eval('input[type="text"], input[type="search"], input:not([type])', els =>
      els.map(el => ({
        name: el.name,
        id: el.id,
        placeholder: el.placeholder || '',
        class: el.className.substring(0, 40)
      })).filter(el => el.name || el.id || el.placeholder)
    );
    console.log('\nテキスト入力欄:');
    textInputs.forEach((input, i) => {
      console.log(`  [${i}]`, JSON.stringify(input));
    });

    // 検索ボタン
    const searchButtons = await page.$$eval('button, input[type="submit"]', els =>
      els.map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().substring(0, 20) || el.value,
        class: el.className.substring(0, 30)
      })).filter(el => el.text && (el.text.includes('検索') || el.text.includes('探す')))
    );
    console.log('\n検索ボタン:');
    searchButtons.forEach((btn, i) => {
      console.log(`  [${i}]`, JSON.stringify(btn));
    });

    // 待機
    console.log('\n--- 30秒間待機中 ---');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/v2_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

exploreSearch();
