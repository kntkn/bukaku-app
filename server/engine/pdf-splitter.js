/**
 * PDF分割モジュール
 * 大容量PDFをページごとに分割して処理可能にする
 */

const { PDFDocument } = require('pdf-lib');

/**
 * PDFをページごとに分割
 * @param {Buffer} pdfBuffer - PDFファイルのBuffer
 * @returns {Promise<{totalPages: number, pageBuffers: Array<{pageNumber: number, buffer: Buffer}>}>}
 */
async function splitPdfToPages(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const pageBuffers = [];

  console.log(`[PDF分割] 全${totalPages}ページを分割開始`);

  for (let i = 0; i < totalPages; i++) {
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
    singlePageDoc.addPage(copiedPage);
    const buffer = Buffer.from(await singlePageDoc.save());

    pageBuffers.push({
      pageNumber: i + 1,
      buffer
    });
  }

  console.log(`[PDF分割] ${totalPages}ページの分割完了`);

  return { totalPages, pageBuffers };
}

/**
 * PDFのページ数のみを取得（分割せずに）
 * @param {Buffer} pdfBuffer - PDFファイルのBuffer
 * @returns {Promise<number>} ページ数
 */
async function getPageCount(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  return pdfDoc.getPageCount();
}

/**
 * 指定ページのみを抽出
 * @param {Buffer} pdfBuffer - PDFファイルのBuffer
 * @param {number} pageNumber - ページ番号（1始まり）
 * @returns {Promise<Buffer>} 単一ページのPDF Buffer
 */
async function extractPage(pdfBuffer, pageNumber) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const singlePageDoc = await PDFDocument.create();
  const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pageNumber - 1]);
  singlePageDoc.addPage(copiedPage);
  return Buffer.from(await singlePageDoc.save());
}

/**
 * 複数のPDFを1つに結合
 * @param {Buffer[]} pdfBuffers - PDFファイルのBuffer配列
 * @returns {Promise<Buffer>} 結合されたPDFのBuffer
 */
async function mergePdfs(pdfBuffers) {
  if (pdfBuffers.length === 1) return pdfBuffers[0];

  const mergedDoc = await PDFDocument.create();

  for (let i = 0; i < pdfBuffers.length; i++) {
    const srcDoc = await PDFDocument.load(pdfBuffers[i]);
    const pageCount = srcDoc.getPageCount();
    const copiedPages = await mergedDoc.copyPages(srcDoc, Array.from({ length: pageCount }, (_, j) => j));
    copiedPages.forEach(page => mergedDoc.addPage(page));
    console.log(`[PDF結合] ${i + 1}/${pdfBuffers.length}ファイル (${pageCount}ページ)`);
  }

  const totalPages = mergedDoc.getPageCount();
  console.log(`[PDF結合] 完了: 合計${totalPages}ページ`);

  return Buffer.from(await mergedDoc.save());
}

module.exports = {
  splitPdfToPages,
  getPageCount,
  extractPage,
  mergePdfs
};
