/**
 * PDF分割モジュール（mupdf高速版）
 * 大容量PDFをページごとに分割して処理可能にする
 */

const { PDFDocument } = require('pdf-lib');

// mupdfをdynamic importでロード（ESMモジュールのため）
let mupdfModule = null;
async function getMupdf() {
  if (!mupdfModule) {
    mupdfModule = await import('mupdf');
  }
  return mupdfModule;
}

/**
 * mupdfを使った高速ストリーミング分割
 * @param {Buffer} pdfBuffer - PDFファイルのBuffer
 * @param {Function} onPageSplit - ページ分割完了コールバック({pageNumber, buffer, total})
 * @returns {Promise<number>} 総ページ数
 */
async function splitPdfStreamingFast(pdfBuffer, onPageSplit) {
  const mupdf = await getMupdf();

  const startTime = Date.now();

  // ソースPDFを開く
  const srcDoc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const srcPdf = srcDoc.asPDF();
  const totalPages = srcDoc.countPages();

  console.log(`[PDF分割/mupdf] 全${totalPages}ページを高速分割開始`);

  for (let i = 0; i < totalPages; i++) {
    // 新しいPDFを作成
    const newDoc = new mupdf.PDFDocument();

    // ページをコピー（graftPage: destPage=-1で末尾追加）
    const graftMap = newDoc.newGraftMap();
    newDoc.graftPage(-1, srcPdf, i, graftMap);

    // バッファとして保存
    const buf = newDoc.saveToBuffer('compress');

    await onPageSplit({
      pageNumber: i + 1,
      buffer: Buffer.from(buf),
      total: totalPages
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[PDF分割/mupdf] ${totalPages}ページの分割完了 (${elapsed}秒)`);

  return totalPages;
}

/**
 * PDFをページごとに分割（pdf-lib版、フォールバック用）
 */
async function splitPdfToPages(pdfBuffer, options = {}) {
  const { onProgress } = options;
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const pageBuffers = [];

  console.log(`[PDF分割/pdf-lib] 全${totalPages}ページを分割開始`);
  onProgress?.({ split: 0, total: totalPages });

  for (let i = 0; i < totalPages; i++) {
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
    singlePageDoc.addPage(copiedPage);
    const buffer = Buffer.from(await singlePageDoc.save());

    pageBuffers.push({
      pageNumber: i + 1,
      buffer
    });

    if ((i + 1) % 10 === 0 || i === totalPages - 1) {
      onProgress?.({ split: i + 1, total: totalPages });
    }
  }

  console.log(`[PDF分割/pdf-lib] ${totalPages}ページの分割完了`);
  return { totalPages, pageBuffers };
}

/**
 * PDFをストリーミング分割（mupdf優先、失敗時はpdf-libにフォールバック）
 */
async function splitPdfStreaming(pdfBuffer, onPageSplit, options = {}) {
  try {
    // mupdfで高速分割を試みる
    return await splitPdfStreamingFast(pdfBuffer, onPageSplit);
  } catch (error) {
    console.warn(`[PDF分割] mupdf失敗、pdf-libにフォールバック: ${error.message}`);

    // pdf-libでフォールバック
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();
    const startTime = Date.now();

    console.log(`[PDF分割/pdf-lib] 全${totalPages}ページをストリーミング分割`);

    for (let i = 0; i < totalPages; i++) {
      const singlePageDoc = await PDFDocument.create();
      const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
      singlePageDoc.addPage(copiedPage);
      const buffer = Buffer.from(await singlePageDoc.save());

      await onPageSplit({
        pageNumber: i + 1,
        buffer,
        total: totalPages
      });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[PDF分割/pdf-lib] ${totalPages}ページの分割完了 (${elapsed}秒)`);
    return totalPages;
  }
}

/**
 * PDFのページ数のみを取得
 */
async function getPageCount(pdfBuffer) {
  try {
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    return doc.countPages();
  } catch {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    return pdfDoc.getPageCount();
  }
}

/**
 * 指定ページのみを抽出
 */
async function extractPage(pdfBuffer, pageNumber) {
  try {
    const mupdf = await getMupdf();
    const srcDoc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const srcPdf = srcDoc.asPDF();

    const newDoc = new mupdf.PDFDocument();
    const graftMap = newDoc.newGraftMap();
    newDoc.graftPage(-1, srcPdf, pageNumber - 1, graftMap);

    return Buffer.from(newDoc.saveToBuffer('compress'));
  } catch {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pageNumber - 1]);
    singlePageDoc.addPage(copiedPage);
    return Buffer.from(await singlePageDoc.save());
  }
}

/**
 * 複数のPDFを1つに結合
 */
async function mergePdfs(pdfBuffers) {
  if (pdfBuffers.length === 1) return pdfBuffers[0];

  try {
    const mupdf = await getMupdf();
    const mergedDoc = new mupdf.PDFDocument();
    const graftMap = mergedDoc.newGraftMap();

    for (let i = 0; i < pdfBuffers.length; i++) {
      const srcDoc = mupdf.Document.openDocument(pdfBuffers[i], 'application/pdf');
      const srcPdf = srcDoc.asPDF();
      const pageCount = srcDoc.countPages();

      for (let j = 0; j < pageCount; j++) {
        mergedDoc.graftPage(-1, srcPdf, j, graftMap);
      }

      console.log(`[PDF結合/mupdf] ${i + 1}/${pdfBuffers.length}ファイル (${pageCount}ページ)`);
    }

    const totalPages = mergedDoc.countPages();
    console.log(`[PDF結合/mupdf] 完了: 合計${totalPages}ページ`);

    return Buffer.from(mergedDoc.saveToBuffer('compress'));
  } catch (error) {
    console.warn(`[PDF結合] mupdf失敗、pdf-libにフォールバック: ${error.message}`);

    // pdf-libでフォールバック
    const mergedDoc = await PDFDocument.create();

    for (let i = 0; i < pdfBuffers.length; i++) {
      const srcDoc = await PDFDocument.load(pdfBuffers[i]);
      const pageCount = srcDoc.getPageCount();
      const copiedPages = await mergedDoc.copyPages(srcDoc, Array.from({ length: pageCount }, (_, j) => j));
      copiedPages.forEach(page => mergedDoc.addPage(page));
      console.log(`[PDF結合/pdf-lib] ${i + 1}/${pdfBuffers.length}ファイル (${pageCount}ページ)`);
    }

    const totalPages = mergedDoc.getPageCount();
    console.log(`[PDF結合/pdf-lib] 完了: 合計${totalPages}ページ`);

    return Buffer.from(await mergedDoc.save());
  }
}

module.exports = {
  splitPdfToPages,
  splitPdfStreaming,
  splitPdfStreamingFast,
  getPageCount,
  extractPage,
  mergePdfs
};
