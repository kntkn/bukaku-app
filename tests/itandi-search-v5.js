/**
 * ITANDI BB 物件検索の実行 v5
 * 所在地モーダルで区を選択してから検索
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
  console.log('=== ITANDI BB 物件検索 v5 ===\n');

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

    // 「所在地で絞り込み」をクリック
    console.log('\n「所在地で絞り込み」をクリック...');
    await page.click('button:has-text("所在地で絞り込み")');
    await page.waitForTimeout(1000);

    // 関東→東京都を選択（既にスクリーンショットでは選択済みだが念のため）
    console.log('東京都を選択...');
    await page.click('text=関東');
    await page.waitForTimeout(300);
    await page.click('text=東京都');
    await page.waitForTimeout(500);

    // 渋谷区を選択
    console.log('渋谷区を選択...');
    await page.click('text=渋谷区');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'tests/screenshots/v5_area_selected.png' });

    // 「確定」ボタンをクリック
    console.log('「確定」をクリック...');
    await page.click('button:has-text("確定")');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/screenshots/v5_after_confirm.png' });

    // 検索ボタンの状態を確認
    const searchButton = await page.$('button[type="submit"]');
    const isDisabled = await searchButton.isDisabled();
    console.log('検索ボタンdisabled:', isDisabled);

    if (!isDisabled) {
      // 検索実行
      console.log('\n検索を実行...');
      await searchButton.click();
      await page.waitForTimeout(5000);
      console.log('✓ 検索完了');
      console.log('  URL:', page.url());

      await page.screenshot({ path: 'tests/screenshots/v5_results.png', fullPage: true });
      console.log('  スクリーンショット: v5_results.png');

      // 結果を調査
      console.log('\n=== 検索結果の構造 ===');

      // 結果件数を取得
      const pageText = await page.textContent('body');
      const countMatch = pageText.match(/(\d+)件/);
      if (countMatch) {
        console.log('検索結果件数:', countMatch[1], '件');
      }

      // テーブル行を探す
      const rows = await page.$$('tr');
      console.log('テーブル行数:', rows.length);

      // 物件リストの構造を調査
      const listItems = await page.$$('[class*="MuiTableRow"], [class*="property"], [class*="item"]');
      console.log('リストアイテム数:', listItems.length);

      // 最初の結果の詳細を見る
      if (rows.length > 1) {
        const firstRow = rows[1]; // ヘッダーを除く
        const cells = await firstRow.$$('td');
        console.log('\n最初の行のセル数:', cells.length);
        for (let i = 0; i < Math.min(cells.length, 10); i++) {
          const text = await cells[i].textContent();
          console.log(`  セル[${i}]:`, text.trim().substring(0, 50));
        }
      }
    }

    // 待機
    console.log('\n--- 30秒間待機中 ---');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/v5_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

searchProperty();
