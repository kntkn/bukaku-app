import { NextResponse } from 'next/server';

/**
 * 物確APIエンドポイント
 *
 * 注意: Playwrightはブラウザを起動するため、Vercelのサーバーレス関数では動作しない
 * 本番環境では、このAPIはRenderバックエンドにプロキシする
 */

export async function POST(request) {
  try {
    const { propertyName, checkAD } = await request.json();

    if (!propertyName) {
      return NextResponse.json(
        { success: false, error: '物件名が必要です' },
        { status: 400 }
      );
    }

    // 本番環境ではRenderバックエンドにリクエストを転送
    const backendUrl = process.env.BACKEND_URL;

    if (backendUrl) {
      // Renderバックエンドに転送
      const response = await fetch(`${backendUrl}/api/bukaku`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyName, checkAD })
      });

      const data = await response.json();
      return NextResponse.json(data);
    }

    // 開発環境: ローカルでPlaywrightを実行
    // 注意: これはサーバーサイドで動作するが、Vercelでは動かない
    if (process.env.NODE_ENV === 'development') {
      try {
        // 動的インポート（サーバーサイドのみ）
        const { bukaku } = await import('../../../src/itandi-bukaku.js');
        const result = await bukaku(propertyName, { headless: true });
        return NextResponse.json(result);
      } catch (playwrightError) {
        console.error('Playwright実行エラー:', playwrightError);
        // Playwrightが動作しない場合はモックレスポンス
        return NextResponse.json({
          success: true,
          property_name: propertyName,
          platform: 'itandi',
          message: '開発環境モック',
          results: [
            {
              raw_text: `${propertyName}の検索結果（モック）`,
              status: 'available',
              has_ad: checkAD ? true : Math.random() > 0.5,
              viewing_available: true
            }
          ]
        });
      }
    }

    // Vercel本番環境でバックエンドURLが設定されていない場合
    return NextResponse.json(
      {
        success: false,
        error: 'バックエンドが設定されていません。BACKEND_URL環境変数を設定してください。'
      },
      { status: 503 }
    );

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: '物確API',
    usage: 'POST /api/bukaku { propertyName: "物件名", checkAD: boolean }'
  });
}
