/**
 * REINS UI操作ヘルパー
 * Playwrightでレインズにログインし、物件検索 → 図面PDFダウンロード
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REINS_URL = 'https://system.reins.jp/reins/ktgyoumu/KG001_001.do';
const REINS_ID = '010364039323';
const REINS_PASS = '08054168320';

const DOWNLOAD_DIR = path.join(__dirname, '../data/downloads');

// 東京都のエリアローテーション用
const TOKYO_AREAS = [
  '千代田区', '中央区', '港区', '新宿区', '文京区',
  '台東区', '墨田区', '江東区', '品川区', '目黒区',
  '大田区', '世田谷区', '渋谷区', '中野区', '杉並区',
  '豊島区', '北区', '荒川区', '板橋区', '練馬区',
  '足立区', '葛飾区', '江戸川区'
];

class ReinsNavigator {
  constructor(options = {}) {
    this.headless = !options.headed;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.downloadCount = 0;
    this.metadata = [];
    this.metadataPath = path.join(DOWNLOAD_DIR, 'metadata.json');
  }

  async init() {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    // 既存メタデータをロード（レジューム用）
    if (fs.existsSync(this.metadataPath)) {
      try {
        this.metadata = JSON.parse(fs.readFileSync(this.metadataPath, 'utf-8'));
        this.downloadCount = this.metadata.length;
        console.log(`[REINS] レジューム: 既に${this.downloadCount}件ダウンロード済み`);
      } catch (e) {
        this.metadata = [];
      }
    }

    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: this.headless ? 0 : 100
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      acceptDownloads: true
    });
    this.page = await this.context.newPage();
    console.log('[REINS] ブラウザ起動完了');
  }

  async login() {
    console.log('[REINS] ログイン中...');
    await this.page.goto(REINS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    // ログインフォームを探して入力
    // REINSはフレームを使用している可能性があるため、メインフレームとiframeの両方を確認
    const frames = this.page.frames();
    let loginFrame = this.page;

    for (const frame of frames) {
      const idInput = await frame.$('input[name="loginId"], input[name="userId"], input#loginId, input#userId');
      if (idInput) {
        loginFrame = frame;
        break;
      }
    }

    // ID入力
    const idSelector = 'input[name="loginId"], input[name="userId"], input#loginId, input#userId, input[type="text"]';
    const passSelector = 'input[name="password"], input#password, input[type="password"]';

    try {
      await loginFrame.waitForSelector(idSelector, { state: 'visible', timeout: 10000 });
      await loginFrame.fill(idSelector, REINS_ID);
      await loginFrame.fill(passSelector, REINS_PASS);

      // ログインボタンクリック
      const submitBtn = await loginFrame.$('input[type="submit"], button[type="submit"], input[value*="ログイン"], button:has-text("ログイン")');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await loginFrame.keyboard.press('Enter');
      }

      await this.page.waitForTimeout(3000);
      console.log(`[REINS] ログイン完了: ${this.page.url()}`);
      return true;
    } catch (error) {
      console.error(`[REINS] ログイン失敗: ${error.message}`);
      // スクリーンショットを保存
      await this.page.screenshot({
        path: path.join(DOWNLOAD_DIR, 'reins-login-error.png')
      });
      return false;
    }
  }

  /**
   * 賃貸物件検索画面に遷移
   */
  async navigateToRentalSearch() {
    console.log('[REINS] 賃貸検索画面に遷移中...');

    // REINSのメニューから賃貸を選択
    // 一般的なREINSの構造: メニュー → 賃貸 → 検索
    try {
      // 賃貸メニューをクリック
      const rentalLink = await this.page.$('a:has-text("賃貸"), a[href*="chintai"], a[href*="CT"]');
      if (rentalLink) {
        await rentalLink.click();
        await this.page.waitForTimeout(2000);
      }

      // 物件検索リンク
      const searchLink = await this.page.$('a:has-text("物件検索"), a:has-text("検索")');
      if (searchLink) {
        await searchLink.click();
        await this.page.waitForTimeout(2000);
      }

      console.log(`[REINS] 検索画面: ${this.page.url()}`);
      return true;
    } catch (error) {
      console.error(`[REINS] 検索画面遷移失敗: ${error.message}`);
      await this.page.screenshot({
        path: path.join(DOWNLOAD_DIR, 'reins-search-nav-error.png')
      });
      return false;
    }
  }

  /**
   * エリアで検索実行
   */
  async searchByArea(areaName) {
    console.log(`[REINS] エリア検索: ${areaName}`);

    try {
      // 東京都を選択
      const tokyoSelector = 'select[name*="todofuken"], select[name*="pref"]';
      const tokyoSelect = await this.page.$(tokyoSelector);
      if (tokyoSelect) {
        await this.page.selectOption(tokyoSelector, { label: '東京都' });
        await this.page.waitForTimeout(1000);
      }

      // 市区町村で検索
      const areaInput = await this.page.$('input[name*="shikuchoson"], input[name*="area"], input[name*="addr"]');
      if (areaInput) {
        await areaInput.fill(areaName);
      }

      // 検索ボタン
      const searchBtn = await this.page.$('input[type="submit"][value*="検索"], button:has-text("検索"), input[value*="表示"]');
      if (searchBtn) {
        await searchBtn.click();
        await this.page.waitForTimeout(3000);
      }

      console.log(`[REINS] 検索完了: ${this.page.url()}`);
      return true;
    } catch (error) {
      console.error(`[REINS] 検索失敗: ${error.message}`);
      return false;
    }
  }

  /**
   * 検索結果一覧から物件を取得してPDFダウンロード
   * @param {number} maxPerArea - エリアあたりの最大取得数
   */
  async downloadFromResults(maxPerArea = 10) {
    const downloaded = [];

    try {
      // 検索結果の物件リンクを取得
      const propertyLinks = await this.page.$$('a[href*="bukken"], a[href*="detail"], tr.data a, td a[href*="KG"]');

      const linksToProcess = propertyLinks.slice(0, maxPerArea);
      console.log(`[REINS] ${propertyLinks.length}件中${linksToProcess.length}件を処理`);

      for (let i = 0; i < linksToProcess.length; i++) {
        if (this.downloadCount >= 100) break; // 100件上限

        try {
          // 物件詳細ページを開く
          const link = linksToProcess[i];
          const href = await link.getAttribute('href');

          // 新しいタブで開く
          const [detailPage] = await Promise.all([
            this.context.waitForEvent('page'),
            link.click({ modifiers: ['Meta'] }) // Cmd+Click で新タブ
          ]).catch(() => [null]);

          const targetPage = detailPage || this.page;
          if (detailPage) await detailPage.waitForLoadState('domcontentloaded');

          await targetPage.waitForTimeout(2000);

          // メタデータ抽出
          const meta = await this._extractMetadata(targetPage);

          // 図面PDFのダウンロード
          const pdfDownloaded = await this._downloadPdf(targetPage, meta);

          if (pdfDownloaded) {
            downloaded.push(meta);
            this.downloadCount++;
            console.log(`[REINS] ${this.downloadCount}件目DL完了: ${meta.propertyName || '不明'}`);
          }

          // タブを閉じる
          if (detailPage && detailPage !== this.page) {
            await detailPage.close();
          }

          // レート制限
          await this.page.waitForTimeout(5000);

          // 10件ごとに保存
          if (this.downloadCount % 10 === 0) {
            this._saveMetadata();
          }
        } catch (error) {
          console.error(`[REINS] 物件${i + 1}処理エラー: ${error.message}`);
        }
      }
    } catch (error) {
      console.error(`[REINS] 一覧処理エラー: ${error.message}`);
    }

    return downloaded;
  }

  /**
   * 物件詳細ページからメタデータ抽出
   */
  async _extractMetadata(page) {
    const meta = {
      downloadedAt: new Date().toISOString(),
      propertyName: null,
      address: null,
      managementCompany: null,
      reinsId: null,
      rent: null,
      floorPlan: null,
      area: null,
      pageUrl: page.url()
    };

    try {
      const bodyText = await page.textContent('body');

      // 物件名
      const nameMatch = bodyText.match(/物件名[称：:\s]*([^\n\r]+)/);
      if (nameMatch) meta.propertyName = nameMatch[1].trim();

      // 住所
      const addrMatch = bodyText.match(/所在地[：:\s]*([^\n\r]+)/);
      if (addrMatch) meta.address = addrMatch[1].trim();

      // 管理会社
      const mgmtMatch = bodyText.match(/(?:管理会社|取引態様|元付)[：:\s]*([^\n\r]+)/);
      if (mgmtMatch) meta.managementCompany = mgmtMatch[1].trim();

      // レインズ番号
      const reinsMatch = bodyText.match(/(?:物件番号|レインズ番号|REINS.*?番号)[：:\s]*([0-9A-Za-z-]+)/);
      if (reinsMatch) meta.reinsId = reinsMatch[1].trim();

      // 賃料
      const rentMatch = bodyText.match(/賃料[：:\s]*([^\n\r]+)/);
      if (rentMatch) meta.rent = rentMatch[1].trim();

    } catch (error) {
      console.warn(`[REINS] メタデータ抽出エラー: ${error.message}`);
    }

    return meta;
  }

  /**
   * 図面PDFをダウンロード
   */
  async _downloadPdf(page, meta) {
    try {
      // 図面/マイソクリンクを探す
      const pdfLink = await page.$('a[href*=".pdf"], a:has-text("図面"), a:has-text("マイソク"), a:has-text("間取"), a[href*="zuumen"], a[href*="zumen"]');

      if (!pdfLink) {
        console.log(`[REINS] PDF/図面リンクが見つからない: ${meta.propertyName || page.url()}`);
        return false;
      }

      // ダウンロードを待つ
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        pdfLink.click()
      ]).catch(() => [null]);

      if (download) {
        const fileName = `${String(this.downloadCount + 1).padStart(3, '0')}_${(meta.reinsId || 'unknown')}.pdf`;
        const savePath = path.join(DOWNLOAD_DIR, fileName);
        await download.saveAs(savePath);
        meta.fileName = fileName;
        meta.filePath = savePath;
        return true;
      }

      // ダウンロードイベントが来ない場合、リンク先のPDFを直接取得
      const href = await pdfLink.getAttribute('href');
      if (href && href.includes('.pdf')) {
        const response = await page.context().request.get(href);
        const buffer = await response.body();
        const fileName = `${String(this.downloadCount + 1).padStart(3, '0')}_${(meta.reinsId || 'unknown')}.pdf`;
        const savePath = path.join(DOWNLOAD_DIR, fileName);
        fs.writeFileSync(savePath, buffer);
        meta.fileName = fileName;
        meta.filePath = savePath;
        return true;
      }

      return false;
    } catch (error) {
      console.warn(`[REINS] PDFダウンロード失敗: ${error.message}`);
      return false;
    }
  }

  /**
   * メタデータを保存
   */
  _saveMetadata() {
    fs.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2));
    console.log(`[REINS] メタデータ保存: ${this.metadata.length}件`);
  }

  /**
   * メインのダウンロードフロー
   * @param {number} targetCount - 目標件数
   */
  async downloadMaisoku(targetCount = 100) {
    console.log(`[REINS] マイソク${targetCount}件ダウンロード開始`);

    const loginSuccess = await this.login();
    if (!loginSuccess) {
      console.error('[REINS] ログイン失敗。手動操作モードでスクリーンショットを確認してください。');
      return this.metadata;
    }

    await this.navigateToRentalSearch();

    // エリアをローテーションしてダウンロード
    const perArea = Math.ceil(targetCount / TOKYO_AREAS.length) + 2;

    for (let i = 0; i < TOKYO_AREAS.length && this.downloadCount < targetCount; i++) {
      const area = TOKYO_AREAS[i];
      console.log(`\n[REINS] === ${area} (${this.downloadCount}/${targetCount}) ===`);

      await this.searchByArea(area);
      const downloaded = await this.downloadFromResults(perArea);
      this.metadata.push(...downloaded);
      this._saveMetadata();

      console.log(`[REINS] ${area}: ${downloaded.length}件ダウンロード (累計: ${this.downloadCount}/${targetCount})`);

      // エリア切り替え時は少し待つ
      await this.page.waitForTimeout(3000);

      // 検索画面に戻る
      await this.navigateToRentalSearch();
    }

    this._saveMetadata();
    console.log(`\n[REINS] ダウンロード完了: ${this.downloadCount}件`);
    return this.metadata;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('[REINS] ブラウザ終了');
    }
  }
}

module.exports = { ReinsNavigator, DOWNLOAD_DIR };
