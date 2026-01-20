/**
 * マイソクPDF解析モジュール
 * Claude APIを使ってマイソク（物件資料）から情報を抽出
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic();

/**
 * マイソクPDFを解析して物件情報を抽出
 * @param {string} pdfPath - PDFファイルのパス
 * @returns {Promise<Object>} 抽出された物件情報
 */
async function parseMaisoku(pdfPath) {
  // PDFをBase64エンコード
  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');

  const prompt = `このマイソク（不動産物件資料）から以下の情報を抽出してください。

抽出する情報：
1. 物件名（建物名）
2. 所在地（住所）
3. 賃料（管理費・共益費も含めて）
4. 管理会社名（帯の部分に記載されていることが多い）
5. AD（広告費）の有無と金額
6. 間取り
7. 専有面積
8. 築年月
9. その他特記事項

JSON形式で回答してください：
{
  "property_name": "物件名",
  "address": "住所",
  "rent": "賃料（例: 85,000円）",
  "management_fee": "管理費・共益費",
  "management_company": "管理会社名",
  "has_ad": true/false,
  "ad_amount": "AD金額（例: 1ヶ月）",
  "floor_plan": "間取り（例: 1K）",
  "area": "専有面積（例: 25.5㎡）",
  "built_date": "築年月",
  "notes": "その他特記事項"
}

情報が見つからない場合はnullを入れてください。`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    });

    // レスポンスからJSONを抽出
    const content = response.content[0].text;

    // JSON部分を抽出（```json ... ``` または { ... } を探す）
    let jsonStr = content;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    return {
      success: true,
      data: parsed,
      raw_response: content
    };

  } catch (error) {
    console.error('マイソク解析エラー:', error.message);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

/**
 * 画像ファイル（JPG/PNG）からマイソクを解析
 * @param {string} imagePath - 画像ファイルのパス
 * @returns {Promise<Object>} 抽出された物件情報
 */
async function parseMaisokuImage(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');

  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const prompt = `このマイソク（不動産物件資料）から以下の情報を抽出してください。

抽出する情報：
1. 物件名（建物名）
2. 所在地（住所）
3. 賃料（管理費・共益費も含めて）
4. 管理会社名（帯の部分に記載されていることが多い）
5. AD（広告費）の有無と金額
6. 間取り
7. 専有面積
8. 築年月
9. その他特記事項

JSON形式で回答してください：
{
  "property_name": "物件名",
  "address": "住所",
  "rent": "賃料（例: 85,000円）",
  "management_fee": "管理費・共益費",
  "management_company": "管理会社名",
  "has_ad": true/false,
  "ad_amount": "AD金額（例: 1ヶ月）",
  "floor_plan": "間取り（例: 1K）",
  "area": "専有面積（例: 25.5㎡）",
  "built_date": "築年月",
  "notes": "その他特記事項"
}

情報が見つからない場合はnullを入れてください。`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    });

    const content = response.content[0].text;

    let jsonStr = content;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    return {
      success: true,
      data: parsed,
      raw_response: content
    };

  } catch (error) {
    console.error('マイソク解析エラー:', error.message);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

/**
 * ファイルタイプに応じて適切な解析関数を呼び出す
 * @param {string} filePath - ファイルパス
 * @returns {Promise<Object>} 抽出された物件情報
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return parseMaisoku(filePath);
  } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    return parseMaisokuImage(filePath);
  } else {
    return {
      success: false,
      error: `未対応のファイル形式: ${ext}`,
      data: null
    };
  }
}

module.exports = {
  parseMaisoku,
  parseMaisokuImage,
  parseFile
};
