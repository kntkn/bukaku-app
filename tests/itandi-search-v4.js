/**
 * ITANDI BB 物件検索の実行 v4
 * 検索条件を入力してから検索
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
  console.log('=== ITANDI BB 物件検索 v4 ===\n');

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

    // 検索フォームの状態を確認
    console.log('\n検索フォームの状態を確認...');

    // 検索ボタンの状態
    const searchButton = await page.$('button[type="submit"]');
    if (searchButton) {
      const isDisabled = await searchButton.isDisabled();
      console.log('  検索ボタンdisabled:', isDisabled);
    }

    // 「所在地で絞り込み」をクリックして条件を設定
    console.log('\n「所在地で絞り込み」をクリック...');
    const locationButton = await page.$('button:has-text("所在地で絞り込み")');
    if (locationButton) {
      await locationButton.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'tests/screenshots/v4_location_modal.png' });
      console.log('  スクリーンショット: v4_location_modal.png');

      // モーダルが開いたら、東京都を選択してみる
      const tokyoOption = await page.$('text=東京都');
      if (tokyoOption) {
        await tokyoOption.click();
        await page.waitForTimeout(500);
        console.log('  ✓ 東京都を選択');
      }

      // 決定/確定ボタンを探す
      const confirmButton = await page.$('button:has-text("決定"), button:has-text("確定"), button:has-text("選択")');
      if (confirmButton) {
        await confirmButton.click();
        await page.waitForTimeout(1000);
        console.log('  ✓ 条件確定');
      }
    }

    await page.screenshot({ path: 'tests/screenshots/v4_after_location.png' });

    // 再度検索ボタンの状態を確認
    const searchButton2 = await page.$('button[type="submit"]');
    if (searchButton2) {
      const isDisabled = await searchButton2.isDisabled();
      console.log('  検索ボタンdisabled:', isDisabled);

      if (!isDisabled) {
        console.log('\n検索を実行...');
        await searchButton2.click();
        await page.waitForTimeout(5000);
        console.log('✓ 検索完了');
        console.log('  URL:', page.url());

        await page.screenshot({ path: 'tests/screenshots/v4_results.png', fullPage: true });
        console.log('  スクリーンショット: v4_results.png');

        // 検索結果を調査
        console.log('\n=== 検索結果の構造 ===');

        // 結果リストを探す
        const resultItems = await page.$$('[class*="ListItem"], [class*="result"], tr');
        console.log('結果アイテム数:', resultItems.length);
      }
    }

    // 待機
    console.log('\n--- 30秒間待機中 ---');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/v4_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

searchProperty();
