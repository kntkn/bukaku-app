/**
 * ITANDI BB 検索結果の詳細分析
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

async function analyzeResults() {
  console.log('=== ITANDI BB 検索結果分析 ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ログイン
    console.log('ログイン中...');
    if (!await login(page)) throw new Error('ログイン失敗');
    console.log('✓ ログイン成功\n');

    // 検索ページへ移動して検索実行
    await page.click('text=リスト検索');
    await page.waitForTimeout(2000);

    // 所在地を設定
    await page.click('button:has-text("所在地で絞り込み")');
    await page.waitForTimeout(500);
    await page.click('text=関東');
    await page.waitForTimeout(200);
    await page.click('text=東京都');
    await page.waitForTimeout(300);
    await page.click('text=渋谷区');
    await page.waitForTimeout(300);
    await page.click('button:has-text("確定")');
    await page.waitForTimeout(1000);

    // 検索実行
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
    console.log('✓ 検索完了\n');

    // 結果カードを分析
    console.log('=== 結果カードの構造分析 ===\n');

    // カード要素を探す（様々なセレクタを試す）
    const cardSelectors = [
      '[class*="Card"]',
      '[class*="card"]',
      '[class*="ListItem"]',
      '[class*="property"]',
      '[class*="Room"]'
    ];

    let cards = [];
    for (const selector of cardSelectors) {
      const found = await page.$$(selector);
      if (found.length > 0) {
        console.log(`${selector}: ${found.length}件`);
        if (cards.length === 0 && found.length > 1) {
          cards = found;
        }
      }
    }

    // 最初のカードの詳細構造を分析
    if (cards.length > 0) {
      console.log('\n--- 最初のカードの分析 ---');
      const firstCard = cards[0];

      // カード内のテキストを全て取得
      const cardText = await firstCard.textContent();
      console.log('\nカード全文（先頭500文字）:');
      console.log(cardText.substring(0, 500));

      // カード内のクラス名を持つ要素を調査
      const innerElements = await firstCard.$$eval('*', els =>
        els.map(el => ({
          tag: el.tagName,
          class: el.className.substring(0, 50),
          text: el.textContent.trim().substring(0, 30)
        })).filter(el => el.class && el.text)
      );

      console.log('\nカード内の主要要素:');
      const uniqueClasses = new Set();
      innerElements.forEach(el => {
        if (!uniqueClasses.has(el.class) && el.text.length > 0) {
          uniqueClasses.add(el.class);
          console.log(`  ${el.tag} .${el.class.split(' ')[0]}: "${el.text}"`);
        }
      });
    }

    // 物確に関連するキーワードを探す
    console.log('\n=== 物確関連キーワードの検索 ===');
    const keywords = ['空室', '募集中', '申込', 'AD', '広告', '内見', '即入居', '退去予定'];

    for (const kw of keywords) {
      const elements = await page.$$(`text=${kw}`);
      if (elements.length > 0) {
        console.log(`「${kw}」: ${elements.length}件発見`);
        // 最初の要素の親要素のクラスを取得
        if (elements[0]) {
          const parentClass = await elements[0].evaluate(el => {
            const parent = el.closest('[class]');
            return parent ? parent.className.substring(0, 50) : 'なし';
          });
          console.log(`  → 親要素クラス: ${parentClass}`);
        }
      }
    }

    // スクリーンショット（最初のカードをハイライト）
    if (cards.length > 0) {
      await cards[0].screenshot({ path: 'tests/screenshots/first_card.png' });
      console.log('\n最初のカードのスクリーンショット: first_card.png');
    }

    // 待機
    console.log('\n--- 20秒間待機中 ---');
    await page.waitForTimeout(20000);

  } catch (error) {
    console.error('エラー:', error.message);
    await page.screenshot({ path: 'tests/screenshots/analysis_error.png' });
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

analyzeResults();
