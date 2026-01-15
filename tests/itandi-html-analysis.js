/**
 * ITANDI BB ページHTML構造の詳細分析
 */

const { chromium } = require('playwright');
const fs = require('fs');

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

async function analyzeHtml() {
  console.log('=== ITANDI BB HTML構造分析 ===\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ログイン
    if (!await login(page)) throw new Error('ログイン失敗');
    console.log('✓ ログイン成功\n');

    // 検索ページへ移動して検索実行
    await page.click('text=リスト検索');
    await page.waitForTimeout(2000);

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

    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);
    console.log('✓ 検索完了\n');

    // メインコンテンツエリアを探す
    console.log('=== メインコンテンツの構造 ===\n');

    // 結果が表示されているエリアを探す
    const mainContent = await page.$('main, [class*="content"], [class*="result"], [class*="list"]');
    if (mainContent) {
      // 直下の子要素を取得
      const children = await mainContent.$$eval(':scope > *', els =>
        els.map(el => ({
          tag: el.tagName,
          class: el.className.substring(0, 60),
          childCount: el.children.length
        }))
      );
      console.log('メインコンテンツの子要素:');
      children.forEach((c, i) => {
        console.log(`  [${i}] ${c.tag} .${c.class.split(' ')[0]} (子要素: ${c.childCount})`);
      });
    }

    // divで「物件」を含むテキストを持つ要素を探す
    console.log('\n=== 物件情報を含む要素 ===\n');

    // 「募集中」バッジの親要素を追跡
    const recruitingBadges = await page.$$('text=募集中');
    if (recruitingBadges.length > 0) {
      console.log('「募集中」バッジを持つ物件カードを分析...\n');

      // 最初の「募集中」要素から上位に遡って物件カードを特定
      const cardStructure = await recruitingBadges[0].evaluate(el => {
        let current = el;
        const path = [];

        // 上に遡る（最大10レベル）
        for (let i = 0; i < 10 && current; i++) {
          path.push({
            tag: current.tagName,
            class: current.className ? current.className.substring(0, 40) : '',
            text: current.textContent.length
          });
          current = current.parentElement;
        }

        return path;
      });

      console.log('「募集中」から上位への要素パス:');
      cardStructure.forEach((node, i) => {
        console.log(`  ${i}: ${node.tag} .${node.class} (text: ${node.text}文字)`);
      });
    }

    // 物件カードらしき繰り返し要素を探す
    console.log('\n=== 繰り返し要素の検出 ===\n');

    // MUIのリストやグリッド構造を探す
    const muiLists = await page.$$('[class*="MuiGrid"], [class*="MuiList"], [class*="MuiCard"]');
    console.log(`MUIコンポーネント: ${muiLists.length}件`);

    // data属性を持つ要素を探す
    const dataElements = await page.$$('[data-testid], [data-id], [data-property]');
    console.log(`data属性を持つ要素: ${dataElements.length}件`);

    // 「募集中」の兄弟要素から物件情報を抽出
    console.log('\n=== 物件カードの詳細情報抽出 ===\n');

    if (recruitingBadges.length > 0) {
      // 「募集中」を含む最小の繰り返し単位を探す
      const propertyInfo = await recruitingBadges[0].evaluate(el => {
        // 上位に遡って、同じクラスの兄弟要素が多数ある親を探す
        let current = el.parentElement;
        while (current) {
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(
              c => c.className === current.className
            );
            if (siblings.length >= 3) {
              // これが繰り返し単位
              return {
                cardClass: current.className,
                cardTag: current.tagName,
                siblingCount: siblings.length,
                textContent: current.textContent.substring(0, 300)
              };
            }
          }
          current = parent;
        }
        return null;
      });

      if (propertyInfo) {
        console.log('物件カードの特定:');
        console.log(`  タグ: ${propertyInfo.cardTag}`);
        console.log(`  クラス: ${propertyInfo.cardClass}`);
        console.log(`  同一カード数: ${propertyInfo.siblingCount}`);
        console.log(`  テキスト内容（抜粋）: ${propertyInfo.textContent.substring(0, 200)}...`);
      }
    }

    // 待機
    console.log('\n--- 15秒間待機中 ---');
    await page.waitForTimeout(15000);

  } catch (error) {
    console.error('エラー:', error.message);
  } finally {
    await browser.close();
    console.log('\n=== 完了 ===');
  }
}

analyzeHtml();
