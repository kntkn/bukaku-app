/**
 * Render Web Service セットアップスクリプト v2
 * ダッシュボードからの操作に特化
 */

const { chromium } = require('playwright');

async function setupRender() {
  console.log('=== Render セットアップ v2 ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Renderダッシュボードに直接アクセス
    console.log('Renderダッシュボードにアクセス中...');
    await page.goto('https://dashboard.render.com/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log('現在のURL:', currentUrl);

    // ログインまたはアカウント作成が必要な場合
    if (!currentUrl.includes('dashboard.render.com') || currentUrl.includes('login') || currentUrl.includes('register')) {
      console.log('\n⚠️ ログインまたはアカウント作成が必要です。');
      console.log('ブラウザで操作を完了してください。');
      console.log('ダッシュボードが表示されるまで待機します（最大3分）...\n');

      await page.waitForURL('https://dashboard.render.com/**', { timeout: 180000 });
      await page.waitForTimeout(3000);
      console.log('✓ ダッシュボードに到達');
    }

    await page.screenshot({ path: 'tests/screenshots/render_v2_dashboard.png' });
    console.log('ダッシュボードのスクリーンショットを保存しました\n');

    // 「New +」ボタンを探す
    console.log('「New」ボタンを探しています...');

    // ページ内のボタンを確認
    const buttons = await page.$$eval('button', els =>
      els.map(el => ({
        text: el.textContent.trim(),
        class: el.className
      })).filter(el => el.text.length > 0 && el.text.length < 30)
    );
    console.log('ボタン一覧:');
    buttons.slice(0, 10).forEach(btn => console.log(`  - "${btn.text}"`));

    // Newボタンをクリック
    const newButton = await page.$('button:has-text("New"), [aria-label*="New"], [data-testid*="new"]');
    if (newButton) {
      await newButton.click();
      await page.waitForTimeout(2000);
      console.log('✓ Newボタンをクリック');
    } else {
      // 別のセレクタを試す
      const newLink = await page.$('a:has-text("New")');
      if (newLink) {
        await newLink.click();
        await page.waitForTimeout(2000);
        console.log('✓ Newリンクをクリック');
      }
    }

    await page.screenshot({ path: 'tests/screenshots/render_v2_new_menu.png' });

    // Web Serviceを選択
    console.log('「Web Service」を選択...');
    await page.click('text=Web Service');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'tests/screenshots/render_v2_service_type.png' });

    // Git repository から構築を選択
    console.log('「Build and deploy from a Git repository」を選択...');
    const gitBuild = await page.$('text=Build and deploy from a Git repository');
    if (gitBuild) {
      await gitBuild.click();
      await page.waitForTimeout(1000);
    }

    // Nextボタンがあればクリック
    const nextButton = await page.$('button:has-text("Next"), button:has-text("Continue")');
    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'tests/screenshots/render_v2_git_repo.png' });

    // リポジトリ一覧が表示されるまで待機
    console.log('GitHubリポジトリ一覧を待機...');
    await page.waitForTimeout(3000);

    // bukaku-appを検索/選択
    console.log('bukaku-appリポジトリを探しています...');

    // 検索ボックスがあれば使用
    const searchBox = await page.$('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Filter"]');
    if (searchBox) {
      await searchBox.fill('bukaku');
      await page.waitForTimeout(2000);
    }

    // bukaku-appをクリック
    const bukakuRepo = await page.$('text=bukaku-app');
    if (bukakuRepo) {
      await bukakuRepo.click();
      await page.waitForTimeout(1000);
      console.log('✓ bukaku-appを選択');
    }

    // Connectボタン
    const connectBtn = await page.$('button:has-text("Connect"), button:has-text("Select")');
    if (connectBtn) {
      await connectBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'tests/screenshots/render_v2_config.png' });

    // 設定フォーム
    console.log('\n設定を入力中...');

    // Name入力
    const nameInput = await page.$('input[name="name"], #name, input[placeholder*="name" i]');
    if (nameInput) {
      await nameInput.fill('');
      await nameInput.fill('bukaku-backend');
      console.log('✓ Name: bukaku-backend');
    }

    // Dockerランタイムを選択（ラジオボタンまたはドロップダウン）
    console.log('Dockerランタイムを選択...');
    const dockerRadio = await page.$('input[value="docker"], label:has-text("Docker") input');
    if (dockerRadio) {
      await dockerRadio.click();
    } else {
      // テキストでクリック
      const dockerText = await page.$('text=Docker');
      if (dockerText) {
        await dockerText.click();
      }
    }

    await page.waitForTimeout(1000);

    // Free プランを選択
    console.log('Freeプランを選択...');
    const freeOption = await page.$('text=Free, input[value="free"], label:has-text("Free")');
    if (freeOption) {
      await freeOption.click();
    }

    await page.screenshot({ path: 'tests/screenshots/render_v2_settings.png' });

    // 環境変数セクションを探す
    console.log('\n環境変数を設定...');

    // Environment Variables セクションを展開
    const envSection = await page.$('text=Environment Variables, button:has-text("Environment")');
    if (envSection) {
      await envSection.click();
      await page.waitForTimeout(1000);
    }

    // Add Environment Variable ボタン
    const addEnvBtn = await page.$('button:has-text("Add Environment Variable"), button:has-text("Add Variable")');
    if (addEnvBtn) {
      // ITANDI_EMAIL
      await addEnvBtn.click();
      await page.waitForTimeout(500);

      const keyInputs = await page.$$('input[placeholder*="KEY" i], input[placeholder*="Key" i], input[name*="key" i]');
      const valueInputs = await page.$$('input[placeholder*="VALUE" i], input[placeholder*="Value" i], input[name*="value" i]');

      if (keyInputs.length > 0) {
        await keyInputs[keyInputs.length - 1].fill('ITANDI_EMAIL');
        if (valueInputs.length > 0) {
          await valueInputs[valueInputs.length - 1].fill('info@fun-t.jp');
        }
        console.log('✓ ITANDI_EMAIL を設定');
      }

      // ITANDI_PASSWORD
      await addEnvBtn.click();
      await page.waitForTimeout(500);

      const keyInputs2 = await page.$$('input[placeholder*="KEY" i], input[placeholder*="Key" i], input[name*="key" i]');
      const valueInputs2 = await page.$$('input[placeholder*="VALUE" i], input[placeholder*="Value" i], input[name*="value" i]');

      if (keyInputs2.length > 0) {
        await keyInputs2[keyInputs2.length - 1].fill('ITANDI_PASSWORD');
        if (valueInputs2.length > 0) {
          await valueInputs2[valueInputs2.length - 1].fill(process.env.ITANDI_PASSWORD || '');
        }
        console.log('✓ ITANDI_PASSWORD を設定');
      }
    }

    await page.screenshot({ path: 'tests/screenshots/render_v2_env.png' });

    console.log('\n========================================');
    console.log('設定が完了しました。');
    console.log('ブラウザで内容を確認し、');
    console.log('「Create Web Service」ボタンをクリックしてください。');
    console.log('========================================\n');

    // 120秒待機（手動確認用）
    console.log('120秒間待機中...');
    await page.waitForTimeout(120000);

    // 最終URL
    console.log('\n最終URL:', page.url());
    await page.screenshot({ path: 'tests/screenshots/render_v2_final.png' });

  } catch (error) {
    console.error('\nエラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/render_v2_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

setupRender();
