/**
 * ITANDI BB ログイン検証スクリプト v4
 *
 * 修正点：ログインを2回試行する
 */

const { chromium } = require('playwright');

const CREDENTIALS = {
  email: 'info@fun-t.jp',
  password: 'funt0406',
  loginUrl: 'https://itandi-accounts.com/login?client_id=itandi_bb&redirect_uri=https%3A%2F%2Fitandibb.com%2Fitandi_accounts_callback&response_type=code&state=d154b03411a94f026786ebb7ab9277ff252cbe88572cbb02261df041314b89d0'
};

async function login(page, attempt) {
  console.log(`\n--- ログイン試行 ${attempt}回目 ---`);

  // ログインページにいるか確認
  if (!page.url().includes('itandi-accounts.com')) {
    console.log('   既にログイン済み');
    return true;
  }

  // 入力欄を待機
  await page.waitForSelector('input#email', { timeout: 5000 });

  const emailInput = await page.$('input#email');
  const passwordInput = await page.$('input#password');
  const submitButton = await page.$('input[type="submit"]');

  if (!emailInput || !passwordInput || !submitButton) {
    console.log('   フォーム要素が見つかりません');
    return false;
  }

  // 入力
  await emailInput.fill(CREDENTIALS.email);
  await passwordInput.fill(CREDENTIALS.password);
  console.log('   入力完了');

  // 送信
  await submitButton.click();
  console.log('   送信完了');

  // 待機
  await page.waitForTimeout(3000);
  console.log('   現在のURL:', page.url());

  return page.url().includes('itandibb.com') && !page.url().includes('login');
}

async function testItandiLogin() {
  console.log('=== ITANDI BB ログイン検証 v4（2回試行）===');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 200
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ログインページにアクセス
    console.log('\nログインページにアクセス中...');
    await page.goto(CREDENTIALS.loginUrl, { waitUntil: 'networkidle' });

    // 1回目のログイン試行
    let success = await login(page, 1);

    // 失敗したら2回目
    if (!success) {
      success = await login(page, 2);
    }

    // 結果
    if (success) {
      console.log('\n✅ ログイン成功！');
      await page.screenshot({ path: 'tests/screenshots/v4_success.png', fullPage: true });
      console.log('   スクリーンショット保存: v4_success.png');

      // ページタイトル
      const title = await page.title();
      console.log('   ページタイトル:', title);
    } else {
      console.log('\n❌ ログイン失敗');
      await page.screenshot({ path: 'tests/screenshots/v4_failed.png' });
    }

    // 待機
    console.log('\n--- 15秒間待機中 ---');
    await page.waitForTimeout(15000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/v4_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

testItandiLogin();
