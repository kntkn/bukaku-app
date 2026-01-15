/**
 * ITANDI BB 物件検索画面の探索 v3
 * HOME画面から「リスト検索」をクリック
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
  console.log('=== ITANDI BB 物件検索（居住用賃貸）v3 ===\n');

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
    console.log('  URL:', page.url());

    // HOME画面で「賃貸」セクションの「リスト検索」をクリック
    console.log('\n「リスト検索」を探してクリック...');

    // 複数の「リスト検索」があるので、最初のもの（賃貸・居住用）をクリック
    const listSearchButtons = await page.$$('text=リスト検索');
    console.log(`  「リスト検索」ボタン数: ${listSearchButtons.length}`);

    if (listSearchButtons.length > 0) {
      await listSearchButtons[0].click();
      await page.waitForTimeout(3000);
      console.log('✓ リスト検索をクリック');
    }

    console.log('  URL:', page.url());
    await page.screenshot({ path: 'tests/screenshots/v3_search_page.png', fullPage: true });
    console.log('  スクリーンショット: v3_search_page.png\n');

    // 検索フォームの構造を調査
    console.log('=== ページ構造の調査 ===\n');

    // ページタイトル
    const title = await page.title();
    console.log('ページタイトル:', title);

    // フォーム要素を全て取得
    const forms = await page.$$('form');
    console.log(`\nフォーム数: ${forms.length}`);

    // テキスト入力欄（placeholderがあるもの）
    const textInputs = await page.$$eval('input', els =>
      els.map(el => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder || ''
      })).filter(el => el.type === 'text' || el.type === 'search' || el.placeholder)
    );
    console.log('\nテキスト入力欄:');
    textInputs.forEach((input, i) => {
      console.log(`  [${i}]`, JSON.stringify(input));
    });

    // ラベルを取得（入力欄の用途を理解するため）
    const labels = await page.$$eval('label', els =>
      els.map(el => ({
        for: el.htmlFor,
        text: el.textContent.trim().substring(0, 30)
      })).filter(el => el.text)
    );
    console.log('\nラベル:');
    labels.slice(0, 20).forEach((label, i) => {
      console.log(`  [${i}]`, JSON.stringify(label));
    });

    // 検索ボタン
    const buttons = await page.$$eval('button, input[type="submit"]', els =>
      els.map(el => ({
        tag: el.tagName,
        type: el.type,
        text: (el.textContent || el.value || '').trim().substring(0, 20),
        class: el.className.substring(0, 30)
      }))
    );
    console.log('\nボタン:');
    buttons.forEach((btn, i) => {
      console.log(`  [${i}]`, JSON.stringify(btn));
    });

    // 待機
    console.log('\n--- 30秒間待機中 ---');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/v3_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

exploreSearch();
