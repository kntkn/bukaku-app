/**
 * ITANDI BB ログイン検証スクリプト
 *
 * 目的: Playwrightでのログインが正常に動作するか確認
 */

const { chromium } = require('playwright');

// 認証情報（本番では環境変数から取得）
const CREDENTIALS = {
  email: 'info@fun-t.jp',
  password: 'funt0406',
  loginUrl: 'https://itandi-accounts.com/login?client_id=itandi_bb&redirect_uri=https%3A%2F%2Fitandibb.com%2Fitandi_accounts_callback&response_type=code&state=d154b03411a94f026786ebb7ab9277ff252cbe88572cbb02261df041314b89d0'
};

async function testItandiLogin() {
  console.log('=== ITANDI BB ログイン検証開始 ===\n');

  // ブラウザ起動（headless: false で実際の画面を表示）
  const browser = await chromium.launch({
    headless: false,  // 検証中は画面を表示
    slowMo: 500       // 操作を500msずつ遅延（視認用）
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. ログインページにアクセス
    console.log('1. ログインページにアクセス中...');
    await page.goto(CREDENTIALS.loginUrl, { waitUntil: 'networkidle' });
    console.log('   現在のURL:', page.url());

    // スクリーンショット保存
    await page.screenshot({ path: 'tests/screenshots/01_login_page.png' });
    console.log('   スクリーンショット保存: 01_login_page.png\n');

    // 2. ログインフォームの要素を探す
    console.log('2. ログインフォーム要素を探索中...');

    // メールアドレス入力欄を探す
    const emailInput = await page.$('input[type="email"], input[name="email"], input[id*="email"]');
    if (emailInput) {
      console.log('   ✓ メールアドレス入力欄を発見');
    } else {
      console.log('   ✗ メールアドレス入力欄が見つかりません');
      // ページ内のinput要素を全て取得して調査
      const inputs = await page.$$('input');
      console.log(`   → ページ内のinput要素数: ${inputs.length}`);
      for (let i = 0; i < inputs.length; i++) {
        const attrs = await inputs[i].evaluate(el => ({
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder
        }));
        console.log(`     input[${i}]:`, attrs);
      }
    }

    // パスワード入力欄を探す
    const passwordInput = await page.$('input[type="password"], input[name="password"]');
    if (passwordInput) {
      console.log('   ✓ パスワード入力欄を発見');
    } else {
      console.log('   ✗ パスワード入力欄が見つかりません');
    }

    // 送信ボタンを探す
    const submitButton = await page.$('button[type="submit"], input[type="submit"]');
    if (submitButton) {
      console.log('   ✓ 送信ボタンを発見\n');
    } else {
      console.log('   ✗ 送信ボタンが見つかりません');
      const buttons = await page.$$('button');
      console.log(`   → ページ内のbutton要素数: ${buttons.length}`);
      for (let i = 0; i < buttons.length; i++) {
        const text = await buttons[i].textContent();
        console.log(`     button[${i}]: "${text.trim()}"`);
      }
    }

    // 3. ログイン実行
    if (emailInput && passwordInput) {
      console.log('3. ログイン情報を入力中...');
      await emailInput.fill(CREDENTIALS.email);
      await passwordInput.fill(CREDENTIALS.password);
      await page.screenshot({ path: 'tests/screenshots/02_filled_form.png' });
      console.log('   スクリーンショット保存: 02_filled_form.png\n');

      console.log('4. ログインボタンをクリック...');
      if (submitButton) {
        await submitButton.click();
      } else {
        // ボタンが見つからない場合はEnterキーで送信
        await passwordInput.press('Enter');
      }

      // ログイン完了を待機
      await page.waitForTimeout(3000);
      console.log('   現在のURL:', page.url());
      await page.screenshot({ path: 'tests/screenshots/03_after_login.png' });
      console.log('   スクリーンショット保存: 03_after_login.png\n');

      // ログイン成功判定
      const currentUrl = page.url();
      if (currentUrl.includes('itandibb.com')) {
        console.log('✅ ログイン成功！\n');

        // ログイン後のページ構造を調査
        console.log('5. ログイン後のページ構造を調査中...');
        const pageTitle = await page.title();
        console.log('   ページタイトル:', pageTitle);

        // ナビゲーション要素を探す
        const navLinks = await page.$$('nav a, .nav a, [class*="menu"] a');
        console.log(`   ナビゲーションリンク数: ${navLinks.length}`);
        for (let i = 0; i < Math.min(navLinks.length, 10); i++) {
          const text = await navLinks[i].textContent();
          const href = await navLinks[i].getAttribute('href');
          console.log(`     [${i}] "${text.trim()}" → ${href}`);
        }
      } else {
        console.log('⚠️ ログイン後のリダイレクトが期待と異なります');
        console.log('   期待: itandibb.com を含むURL');
        console.log('   実際:', currentUrl);
      }
    }

    // 10秒間待機（手動確認用）
    console.log('\n--- 10秒間待機中（手動で画面を確認できます）---');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('エラー発生:', error.message);
    await page.screenshot({ path: 'tests/screenshots/error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 検証完了 ===');
  }
}

// 実行
testItandiLogin();
