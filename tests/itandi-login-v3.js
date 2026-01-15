/**
 * ITANDI BB ログイン検証スクリプト v3
 *
 * 修正点：
 * - ログインボタンを input[type="submit"] に変更
 */

const { chromium } = require('playwright');

const CREDENTIALS = {
  email: 'info@fun-t.jp',
  password: 'funt0406',
  loginUrl: 'https://itandi-accounts.com/login?client_id=itandi_bb&redirect_uri=https%3A%2F%2Fitandibb.com%2Fitandi_accounts_callback&response_type=code&state=d154b03411a94f026786ebb7ab9277ff252cbe88572cbb02261df041314b89d0'
};

async function testItandiLogin() {
  console.log('=== ITANDI BB ログイン検証 v3 ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. ログインページにアクセス
    console.log('1. ログインページにアクセス中...');
    await page.goto(CREDENTIALS.loginUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    console.log('   URL:', page.url());

    // 2. ログイン情報を入力
    console.log('\n2. ログイン情報を入力中...');

    const emailInput = await page.$('input#email');
    const passwordInput = await page.$('input#password');
    const submitButton = await page.$('input[type="submit"].filled-button');

    if (!emailInput || !passwordInput || !submitButton) {
      throw new Error('必要な要素が見つかりません');
    }

    console.log('   ✓ メールアドレス欄を発見');
    console.log('   ✓ パスワード欄を発見');
    console.log('   ✓ 送信ボタンを発見（input[type="submit"]）');

    await emailInput.fill(CREDENTIALS.email);
    await passwordInput.fill(CREDENTIALS.password);

    await page.screenshot({ path: 'tests/screenshots/v3_01_filled.png' });
    console.log('   スクリーンショット保存: v3_01_filled.png');

    // 3. ログインボタンをクリック
    console.log('\n3. ログインボタンをクリック...');
    console.log('   クリック前URL:', page.url());

    // クリックしてナビゲーションを待つ
    await Promise.all([
      page.waitForURL(/itandibb\.com/, { timeout: 15000 }).catch((e) => {
        console.log('   ⚠ URLの変化待機がタイムアウト:', e.message);
      }),
      submitButton.click()
    ]);

    await page.waitForTimeout(3000);
    console.log('   クリック後URL:', page.url());

    await page.screenshot({ path: 'tests/screenshots/v3_02_after_login.png' });
    console.log('   スクリーンショット保存: v3_02_after_login.png');

    // 4. ログイン結果を判定
    const currentUrl = page.url();
    if (currentUrl.includes('itandibb.com') && !currentUrl.includes('login')) {
      console.log('\n✅ ログイン成功！');

      // ログイン後のページ情報を取得
      console.log('\n4. ログイン後のページを調査中...');
      const pageTitle = await page.title();
      console.log('   ページタイトル:', pageTitle);

      // ナビゲーションメニューを探す
      await page.screenshot({ path: 'tests/screenshots/v3_03_dashboard.png', fullPage: true });
      console.log('   スクリーンショット保存: v3_03_dashboard.png');

      // 物件検索に関連するリンクを探す
      const links = await page.$$eval('a', anchors =>
        anchors.map(a => ({
          text: a.textContent.trim().substring(0, 50),
          href: a.href
        })).filter(a => a.text && a.href)
      );

      console.log('\n   主要なリンク:');
      const keywords = ['物件', '検索', '確認', '空室', '募集'];
      links.forEach(link => {
        if (keywords.some(kw => link.text.includes(kw) || link.href.includes(kw))) {
          console.log(`     "${link.text}" → ${link.href}`);
        }
      });

    } else if (currentUrl.includes('itandi-accounts.com')) {
      console.log('\n⚠️ ログイン失敗 - まだログインページにいます');

      // エラーメッセージを確認
      const pageContent = await page.textContent('body');
      if (pageContent.includes('パスワード') || pageContent.includes('メールアドレス')) {
        console.log('   認証情報に問題がある可能性があります');
      }
    } else {
      console.log('\n⚠️ 予期しないページにリダイレクト:', currentUrl);
    }

    // 待機（手動確認用）
    console.log('\n--- 15秒間待機中 ---');
    await page.waitForTimeout(15000);

  } catch (error) {
    console.error('\nエラー発生:', error.message);
    await page.screenshot({ path: 'tests/screenshots/v3_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 検証完了 ===');
  }
}

testItandiLogin();
