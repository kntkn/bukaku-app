/**
 * ITANDI BB 物確スクリプト
 * 物件名で検索し、空室状況・AD情報を取得
 */

const { chromium } = require('playwright');
const yaml = require('yaml');
const fs = require('fs');
const path = require('path');

// スキル定義を読み込み
const skillPath = path.join(__dirname, '../skills/itandi.yaml');
const skill = yaml.parse(fs.readFileSync(skillPath, 'utf-8'));

// 認証情報（環境変数または設定ファイルから取得）
const CREDENTIALS = {
  email: process.env.ITANDI_EMAIL || 'info@fun-t.jp',
  password: process.env.ITANDI_PASSWORD || 'funt0406'
};

/**
 * ITANDIにログイン
 */
async function login(page) {
  console.log('[ITANDI] ログイン中...');
  await page.goto(skill.login.url, { waitUntil: 'networkidle' });

  // 2回試行が必要
  for (let i = 0; i < skill.login.retry_count; i++) {
    if (page.url().includes(skill.login.success_indicator.url_contains)) {
      console.log('[ITANDI] ✓ ログイン成功');
      return true;
    }

    const emailInput = await page.$(skill.login.selectors.email_input);
    if (emailInput) {
      await emailInput.fill(CREDENTIALS.email);
      await page.fill(skill.login.selectors.password_input, CREDENTIALS.password);
      await page.click(skill.login.selectors.submit_button);
      await page.waitForTimeout(3000);
    }
  }

  const success = page.url().includes('itandibb.com');
  if (success) {
    console.log('[ITANDI] ✓ ログイン成功');
  } else {
    console.log('[ITANDI] ✗ ログイン失敗');
  }
  return success;
}

/**
 * 検索ページへ移動
 */
async function navigateToSearch(page) {
  console.log('[ITANDI] 検索ページへ移動中...');

  const listSearchButtons = await page.$$('text=リスト検索');
  if (listSearchButtons.length > 0) {
    await listSearchButtons[0].click();
    await page.waitForTimeout(2000);
  }

  console.log('[ITANDI] ✓ 検索ページ:', page.url());
}

/**
 * 物件名で検索
 */
async function searchByPropertyName(page, propertyName) {
  console.log(`[ITANDI] 物件名「${propertyName}」で検索中...`);

  // 物件名入力欄に入力
  const buildingNameInput = await page.$(skill.search.form.building_name.selector);
  if (buildingNameInput) {
    await buildingNameInput.fill(propertyName);
    await page.waitForTimeout(500);
  }

  // 検索ボタンをクリック
  const searchButton = await page.$(skill.search.submit_button);
  if (searchButton) {
    const isDisabled = await searchButton.isDisabled();
    if (isDisabled) {
      // 検索ボタンがdisabledの場合、所在地を設定
      console.log('[ITANDI] 所在地を設定中...');
      await page.click(skill.search.location_filter.open_button);
      await page.waitForTimeout(500);
      await page.click('text=関東');
      await page.waitForTimeout(200);
      await page.click('text=東京都');
      await page.waitForTimeout(300);
      // 全域を選択
      const allArea = await page.$('text=全域');
      if (allArea) {
        await allArea.click();
        await page.waitForTimeout(300);
      }
      await page.click(skill.search.location_filter.confirm_button);
      await page.waitForTimeout(1000);
    }

    await searchButton.click();
    await page.waitForTimeout(5000);
    console.log('[ITANDI] ✓ 検索完了');
  }
}

/**
 * 検索結果から物件情報を抽出
 */
async function extractResults(page, targetPropertyName) {
  console.log('[ITANDI] 検索結果を解析中...');

  const results = [];

  // ページ内のテキストから物件情報を抽出
  const pageText = await page.textContent('body');

  // 物件カードを取得（セレクタは変わる可能性があるため、複数パターンを試す）
  const cardSelectors = [
    skill.result.property_card.selector,
    '[class*="itandi-bb-ui__Box"][class*="css-1tqsbsd"]',
    '[class*="Box"][class*="tqsbsd"]'
  ];

  let cards = [];
  for (const selector of cardSelectors) {
    cards = await page.$$(selector);
    if (cards.length > 0) break;
  }

  console.log(`[ITANDI] 物件カード数: ${cards.length}`);

  // 各カードから情報を抽出
  for (let i = 0; i < Math.min(cards.length, 10); i++) {
    const card = cards[i];
    const cardText = await card.textContent();

    // 対象物件名を含むか確認
    if (targetPropertyName && !cardText.includes(targetPropertyName)) {
      continue;
    }

    const propertyInfo = {
      raw_text: cardText.substring(0, 300),
      status: 'unknown',
      has_ad: false,
      viewing_available: false
    };

    // 募集状況を判定
    if (cardText.includes('募集中')) {
      propertyInfo.status = 'available';
    } else if (cardText.includes('申込あり') || cardText.includes('商談中')) {
      propertyInfo.status = 'applied';
    } else if (cardText.includes('成約済') || cardText.includes('募集終了')) {
      propertyInfo.status = 'unavailable';
    }

    // AD（広告費）の有無
    if (cardText.includes('広告費') || cardText.includes('AD')) {
      propertyInfo.has_ad = true;
    }

    // 内見可否
    if (cardText.includes('内見可') || cardText.includes('即内見')) {
      propertyInfo.viewing_available = true;
    }

    results.push(propertyInfo);
  }

  return results;
}

/**
 * 物確を実行
 */
async function bukaku(propertyName, options = {}) {
  const { headless = true } = options;

  console.log('=== ITANDI BB 物確開始 ===\n');
  console.log(`対象物件: ${propertyName}\n`);

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 100
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ログイン
    const loggedIn = await login(page);
    if (!loggedIn) {
      throw new Error('ログインに失敗しました');
    }

    // 検索ページへ移動
    await navigateToSearch(page);

    // 物件名で検索
    await searchByPropertyName(page, propertyName);

    // 結果を抽出
    const results = await extractResults(page, propertyName);

    console.log('\n=== 物確結果 ===\n');

    if (results.length === 0) {
      console.log('該当物件が見つかりませんでした');
      return {
        success: false,
        property_name: propertyName,
        platform: 'itandi',
        message: '該当物件なし',
        results: []
      };
    }

    results.forEach((result, i) => {
      console.log(`[${i + 1}] ステータス: ${result.status}`);
      console.log(`    AD: ${result.has_ad ? 'あり' : 'なし'}`);
      console.log(`    内見: ${result.viewing_available ? '可' : '要確認'}`);
      console.log('');
    });

    return {
      success: true,
      property_name: propertyName,
      platform: 'itandi',
      results
    };

  } catch (error) {
    console.error('エラー:', error.message);
    return {
      success: false,
      property_name: propertyName,
      platform: 'itandi',
      error: error.message,
      results: []
    };
  } finally {
    await browser.close();
    console.log('\n=== 物確完了 ===');
  }
}

// CLI実行
if (require.main === module) {
  const propertyName = process.argv[2] || '';

  if (!propertyName) {
    console.log('使用方法: node itandi-bukaku.js <物件名>');
    console.log('例: node itandi-bukaku.js "パームス代々木"');
    process.exit(1);
  }

  bukaku(propertyName, { headless: false }).then(result => {
    console.log('\n最終結果:', JSON.stringify(result, null, 2));
  });
}

module.exports = { bukaku, login, searchByPropertyName, extractResults };
