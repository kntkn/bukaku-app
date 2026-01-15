/**
 * ITANDI BB ログイン検証スクリプト v2
 *
 * 修正点：
 * - ログインボタンのセレクタを改善
 * - エラーメッセージの確認を追加
 * - 待機時間を延長
 */

const { chromium } = require('playwright');

const CREDENTIALS = {
  email: 'info@fun-t.jp',
  password: 'funt0406',
  loginUrl: 'https://itandi-accounts.com/login?client_id=itandi_bb&redirect_uri=https%3A%2F%2Fitandibb.com%2Fitandi_accounts_callback&response_type=code&state=d154b03411a94f026786ebb7ab9277ff252cbe88572cbb02261df041314b89d0'
};

async function testItandiLogin() {
  console.log('=== ITANDI BB ログイン検証 v2 ===\n');

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

    // ページのHTMLを一部取得して構造を確認
    console.log('\n2. ページ構造を調査中...');

    // 右側のログインフォームを特定
    const loginForm = await page.$('form');
    if (loginForm) {
      console.log('   ✓ フォーム要素を発見');
    }

    // 全てのinput要素を詳細に調査
    const allInputs = await page.$$eval('input', inputs =>
      inputs.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        class: input.className
      }))
    );
    console.log('   Input要素一覧:');
    allInputs.forEach((input, i) => {
      console.log(`     [${i}]`, JSON.stringify(input));
    });

    // 全てのbutton要素を調査
    const allButtons = await page.$$eval('button', buttons =>
      buttons.map(btn => ({
        type: btn.type,
        text: btn.textContent.trim(),
        class: btn.className
      }))
    );
    console.log('   Button要素一覧:');
    allButtons.forEach((btn, i) => {
      console.log(`     [${i}]`, JSON.stringify(btn));
    });

    // 3. メールアドレス入力（より具体的なセレクタ）
    console.log('\n3. ログイン情報を入力中...');

    // メールアドレス欄を探す（複数の候補を試す）
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="example"]',
      'input[placeholder*="メール"]'
    ];

    let emailInput = null;
    for (const selector of emailSelectors) {
      emailInput = await page.$(selector);
      if (emailInput) {
        console.log(`   ✓ メールアドレス欄を発見: ${selector}`);
        break;
      }
    }

    // パスワード欄
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      console.log('   ✓ パスワード欄を発見');
    }

    if (emailInput && passwordInput) {
      // 入力をクリア後に入力
      await emailInput.click();
      await emailInput.fill('');
      await emailInput.fill(CREDENTIALS.email);

      await passwordInput.click();
      await passwordInput.fill('');
      await passwordInput.fill(CREDENTIALS.password);

      await page.screenshot({ path: 'tests/screenshots/v2_01_filled.png' });
      console.log('   スクリーンショット保存: v2_01_filled.png');

      // 4. ログインボタンをクリック
      console.log('\n4. ログインボタンを探してクリック...');

      // オレンジのログインボタンを探す
      const loginButtonSelectors = [
        'button:has-text("ログイン")',
        'button[type="submit"]',
        'button.login-button',
        'input[type="submit"]'
      ];

      let loginButton = null;
      for (const selector of loginButtonSelectors) {
        loginButton = await page.$(selector);
        if (loginButton) {
          const buttonText = await loginButton.textContent();
          console.log(`   ✓ ログインボタンを発見: ${selector} (text: "${buttonText.trim()}")`);
          break;
        }
      }

      if (loginButton) {
        // クリック前のURL
        console.log('   クリック前URL:', page.url());

        // ナビゲーションを待機しながらクリック
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {
            console.log('   ⚠ ナビゲーションがタイムアウト');
          }),
          loginButton.click()
        ]);

        await page.waitForTimeout(2000);
        console.log('   クリック後URL:', page.url());

        await page.screenshot({ path: 'tests/screenshots/v2_02_after_click.png' });
        console.log('   スクリーンショット保存: v2_02_after_click.png');

        // エラーメッセージを確認
        console.log('\n5. エラーメッセージを確認中...');
        const errorSelectors = [
          '.error',
          '.error-message',
          '[class*="error"]',
          '[class*="alert"]',
          'p[style*="color: red"]',
          'span[style*="color: red"]'
        ];

        for (const selector of errorSelectors) {
          const errorEl = await page.$(selector);
          if (errorEl) {
            const errorText = await errorEl.textContent();
            if (errorText.trim()) {
              console.log(`   ⚠ エラー発見 (${selector}): "${errorText.trim()}"`);
            }
          }
        }

        // ページ内のテキストでエラーを探す
        const pageText = await page.textContent('body');
        if (pageText.includes('パスワードが違います') ||
            pageText.includes('メールアドレスが見つかりません') ||
            pageText.includes('ログインできません') ||
            pageText.includes('エラー')) {
          console.log('   ⚠ ページ内にエラーメッセージの可能性あり');
        }

        // ログイン成功判定
        const currentUrl = page.url();
        if (currentUrl.includes('itandibb.com') && !currentUrl.includes('login')) {
          console.log('\n✅ ログイン成功！');
        } else if (currentUrl.includes('itandi-accounts.com')) {
          console.log('\n⚠️ まだログインページにいます。認証情報を確認してください。');
        }
      }
    }

    // 30秒間待機（手動確認用）
    console.log('\n--- 30秒間待機中（手動で画面を確認できます）---');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('エラー発生:', error.message);
    await page.screenshot({ path: 'tests/screenshots/v2_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 検証完了 ===');
  }
}

testItandiLogin();
