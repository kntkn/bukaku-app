/**
 * Render Web Service セットアップスクリプト
 */

const { chromium } = require('playwright');

async function setupRender() {
  console.log('=== Render セットアップ開始 ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Renderダッシュボードにアクセス
    console.log('Renderダッシュボードにアクセス中...');
    await page.goto('https://dashboard.render.com/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // ログイン状態を確認
    const currentUrl = page.url();
    console.log('現在のURL:', currentUrl);

    if (currentUrl.includes('login') || currentUrl.includes('signin')) {
      console.log('\n⚠️ ログインが必要です。');
      console.log('ブラウザでGitHubアカウントでログインしてください。');
      console.log('ログイン完了後、ダッシュボードが表示されるまで待機します...\n');

      // ダッシュボードが表示されるまで待機（最大2分）
      await page.waitForURL('**/dashboard**', { timeout: 120000 });
      console.log('✓ ログイン完了');
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/screenshots/render_dashboard.png' });

    // 「New +」ボタンをクリック
    console.log('\n「New +」ボタンを探してクリック...');
    const newButton = await page.$('button:has-text("New"), [data-testid="new-button"], a:has-text("New")');
    if (newButton) {
      await newButton.click();
      await page.waitForTimeout(1000);
    } else {
      // 別のセレクタを試す
      await page.click('text=New');
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'tests/screenshots/render_new_menu.png' });

    // 「Web Service」を選択
    console.log('「Web Service」を選択...');
    await page.click('text=Web Service');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/screenshots/render_web_service.png' });

    // 「Build and deploy from a Git repository」を選択
    console.log('「Build and deploy from a Git repository」を選択...');
    const gitOption = await page.$('text=Build and deploy from a Git repository');
    if (gitOption) {
      await gitOption.click();
      await page.waitForTimeout(1000);

      // Nextボタンがあればクリック
      const nextButton = await page.$('button:has-text("Next"), button:has-text("Continue")');
      if (nextButton) {
        await nextButton.click();
        await page.waitForTimeout(2000);
      }
    }

    await page.screenshot({ path: 'tests/screenshots/render_git_select.png' });

    // GitHubリポジトリを検索
    console.log('GitHubリポジトリを検索...');

    // 検索ボックスを探す
    const searchInput = await page.$('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]');
    if (searchInput) {
      await searchInput.fill('bukaku-app');
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'tests/screenshots/render_repo_search.png' });

    // bukaku-appリポジトリを選択
    console.log('bukaku-appリポジトリを選択...');
    const repoOption = await page.$('text=bukaku-app');
    if (repoOption) {
      await repoOption.click();
      await page.waitForTimeout(1000);

      // Connectボタンがあればクリック
      const connectButton = await page.$('button:has-text("Connect"), button:has-text("Select")');
      if (connectButton) {
        await connectButton.click();
        await page.waitForTimeout(2000);
      }
    }

    await page.screenshot({ path: 'tests/screenshots/render_repo_selected.png' });

    // サービス設定
    console.log('\nサービス設定を入力...');

    // Name
    const nameInput = await page.$('input[name="name"], input[placeholder*="Name"]');
    if (nameInput) {
      await nameInput.fill('');
      await nameInput.fill('bukaku-backend');
      console.log('✓ Name: bukaku-backend');
    }

    // Runtime: Docker を選択
    console.log('Runtime: Docker を選択...');
    const dockerOption = await page.$('text=Docker, label:has-text("Docker"), input[value="docker"]');
    if (dockerOption) {
      await dockerOption.click();
    } else {
      // ドロップダウンから選択
      const runtimeSelect = await page.$('select[name="runtime"], [data-testid="runtime-select"]');
      if (runtimeSelect) {
        await runtimeSelect.selectOption('docker');
      }
    }

    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/screenshots/render_config.png' });

    // Instance Type: Free を選択
    console.log('Instance Type: Free を選択...');
    const freeOption = await page.$('text=Free, label:has-text("Free"), input[value="free"]');
    if (freeOption) {
      await freeOption.click();
    }

    await page.waitForTimeout(1000);

    // 環境変数を設定
    console.log('\n環境変数を設定...');

    // 「Add Environment Variable」ボタンを探す
    const addEnvButton = await page.$('button:has-text("Add Environment Variable"), text=Add Environment Variable');
    if (addEnvButton) {
      // ITANDI_EMAIL
      await addEnvButton.click();
      await page.waitForTimeout(500);

      const keyInputs = await page.$$('input[name*="key"], input[placeholder*="Key"]');
      const valueInputs = await page.$$('input[name*="value"], input[placeholder*="Value"]');

      if (keyInputs.length > 0 && valueInputs.length > 0) {
        await keyInputs[keyInputs.length - 1].fill('ITANDI_EMAIL');
        await valueInputs[valueInputs.length - 1].fill('info@fun-t.jp');
        console.log('✓ ITANDI_EMAIL を設定');
      }

      // ITANDI_PASSWORD
      await addEnvButton.click();
      await page.waitForTimeout(500);

      const keyInputs2 = await page.$$('input[name*="key"], input[placeholder*="Key"]');
      const valueInputs2 = await page.$$('input[name*="value"], input[placeholder*="Value"]');

      if (keyInputs2.length > 0 && valueInputs2.length > 0) {
        await keyInputs2[keyInputs2.length - 1].fill('ITANDI_PASSWORD');
        await valueInputs2[valueInputs2.length - 1].fill('funt0406');
        console.log('✓ ITANDI_PASSWORD を設定');
      }
    }

    await page.screenshot({ path: 'tests/screenshots/render_env_vars.png' });

    console.log('\n--- 設定確認 ---');
    console.log('ブラウザで設定内容を確認し、「Create Web Service」ボタンをクリックしてください。');
    console.log('60秒間待機します...\n');

    await page.waitForTimeout(60000);

    // 最終スクリーンショット
    await page.screenshot({ path: 'tests/screenshots/render_final.png' });
    console.log('最終URL:', page.url());

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/render_error.png' });
  } finally {
    console.log('\n=== セットアップ完了 ===');
    await browser.close();
  }
}

setupRender();
