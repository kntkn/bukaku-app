'use client';

import { useState, useRef, useEffect } from 'react';

// バックエンドURL
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://bukaku-backend.onrender.com';
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

export default function Home() {
  const [propertyName, setPropertyName] = useState('');
  const [checkAD, setCheckAD] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  // リアルタイムプレビュー用のstate
  const [screenshot, setScreenshot] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const wsRef = useRef(null);

  // マイソク解析用のstate
  const [pdfFile, setPdfFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [selectedPropertyIndex, setSelectedPropertyIndex] = useState(0); // 選択中の物件インデックス
  const fileInputRef = useRef(null);

  // Notion連携用のstate
  const [isRecording, setIsRecording] = useState(false);
  const [notionResult, setNotionResult] = useState(null);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // マイソクPDF解析
  const handlePdfParse = async () => {
    if (!pdfFile) {
      setError('PDFファイルを選択してください');
      return;
    }

    setIsParsing(true);
    setError(null);
    setParsedData(null);

    try {
      const formData = new FormData();
      formData.append('pdf', pdfFile);

      const response = await fetch(`${BACKEND_URL}/api/maisoku/parse`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        // APIは配列を返す（複数物件対応）
        const properties = Array.isArray(data.data) ? data.data : [data.data];
        setParsedData(properties);
        setSelectedPropertyIndex(0); // 最初の物件を選択状態に
        // 物件名が取得できたら自動入力（最初の物件）
        if (properties.length > 0 && properties[0].property_name) {
          setPropertyName(properties[0].property_name);
        }
      } else {
        setError(data.error || 'マイソク解析に失敗しました');
      }
    } catch (err) {
      setError('通信エラーが発生しました');
    } finally {
      setIsParsing(false);
    }
  };

  const handleBukaku = async () => {
    // 選択された物件を取得
    const selectedProperty = parsedData?.[selectedPropertyIndex];
    const propertyNameToSearch = selectedProperty?.property_name || propertyName;
    if (!propertyNameToSearch?.trim()) {
      setError('マイソクを解析して物件名を抽出してください');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setScreenshot(null);
    setStatusMessage('セッションを開始中...');

    try {
      // 1. セッションを開始
      const startResponse = await fetch(`${BACKEND_URL}/api/bukaku/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName: propertyNameToSearch.trim(),
          checkAD,
          platform: 'itandi',
          managementCompany: selectedProperty?.management_company
        })
      });

      const startData = await startResponse.json();

      if (!startData.success) {
        throw new Error(startData.error || 'セッション開始に失敗しました');
      }

      const { sessionId } = startData;
      setStatusMessage('WebSocket接続中...');

      // 2. WebSocket接続
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatusMessage('物確を開始しています...');
        // 物確開始メッセージを送信
        ws.send(JSON.stringify({
          type: 'start_bukaku',
          sessionId
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'status':
            setStatusMessage(data.message);
            break;

          case 'screenshot':
            setScreenshot(data.image);
            break;

          case 'result':
            if (data.success) {
              setResults(data);
            } else {
              setError(data.error || '物確に失敗しました');
            }
            setIsLoading(false);
            setStatusMessage('');
            ws.close();
            break;

          case 'error':
            setError(data.message);
            setIsLoading(false);
            setStatusMessage('');
            ws.close();
            break;
        }
      };

      ws.onerror = () => {
        setError('WebSocket接続エラーが発生しました');
        setIsLoading(false);
        setStatusMessage('');
      };

      ws.onclose = () => {
        wsRef.current = null;
      };

    } catch (err) {
      setError(err.message || '通信エラーが発生しました');
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleCancel = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setIsLoading(false);
    setStatusMessage('');
    setScreenshot(null);
  };

  // Notionに記録
  const handleNotionRecord = async () => {
    if (!results) return;

    setIsRecording(true);
    setNotionResult(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/notion/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName,
          results: results.results,
          platform: results.platform,
          parsedData
        })
      });

      const data = await response.json();

      if (data.success) {
        setNotionResult({
          success: true,
          url: data.url
        });
      } else {
        setNotionResult({
          success: false,
          error: data.error
        });
      }
    } catch (err) {
      setNotionResult({
        success: false,
        error: '通信エラーが発生しました'
      });
    } finally {
      setIsRecording(false);
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>物確アプリ</h1>
        <p style={styles.subtitle}>不動産物件確認の自動化ツール</p>
      </header>

      <main style={styles.main}>
        {/* マイソク解析セクション */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>マイソク解析</h2>
          <p style={styles.description}>
            マイソク（物件資料PDF）をアップロードすると、AIが物件情報を自動抽出します
          </p>

          <div style={styles.uploadArea}>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files[0])}
              ref={fileInputRef}
              style={{ display: 'none' }}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              style={styles.dropZone}
            >
              {pdfFile ? (
                <p>{pdfFile.name}</p>
              ) : (
                <p>クリックしてPDFを選択</p>
              )}
            </div>
          </div>

          <button
            onClick={handlePdfParse}
            disabled={isParsing || !pdfFile}
            style={{
              ...styles.button,
              backgroundColor: '#3b82f6',
              opacity: (isParsing || !pdfFile) ? 0.6 : 1,
              cursor: (isParsing || !pdfFile) ? 'not-allowed' : 'pointer'
            }}
          >
            {isParsing ? '解析中...' : 'マイソクを解析'}
          </button>

          {/* 解析結果表示 */}
          {parsedData && parsedData.length > 0 && (
            <div style={styles.parsedDataBox}>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>
                抽出された物件情報 ({parsedData.length}件)
                {parsedData.length > 1 && (
                  <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 8, color: '#6b7280' }}>
                    - 物確する物件を選択
                  </span>
                )}
              </h3>
              {parsedData.map((property, index) => (
                <div
                  key={index}
                  onClick={() => !isLoading && setSelectedPropertyIndex(index)}
                  style={{
                    marginBottom: index < parsedData.length - 1 ? '12px' : 0,
                    padding: '12px',
                    borderRadius: '6px',
                    border: selectedPropertyIndex === index ? '2px solid #10b981' : '1px solid #d1d5db',
                    backgroundColor: selectedPropertyIndex === index ? '#f0fdf4' : '#fff',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <input
                      type="radio"
                      name="selectedProperty"
                      checked={selectedPropertyIndex === index}
                      onChange={() => setSelectedPropertyIndex(index)}
                      disabled={isLoading}
                      style={{ marginRight: 8 }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: selectedPropertyIndex === index ? '#166534' : '#374151' }}>
                      {property.property_name || `物件 ${index + 1}`}
                    </span>
                  </div>
                  <div style={styles.parsedGrid}>
                    {property.address && (
                      <div style={styles.parsedItem}>
                        <span style={styles.parsedLabel}>住所</span>
                        <span style={styles.parsedValue}>{property.address}</span>
                      </div>
                    )}
                    {property.rent && (
                      <div style={styles.parsedItem}>
                        <span style={styles.parsedLabel}>賃料</span>
                        <span style={styles.parsedValue}>{property.rent}</span>
                      </div>
                    )}
                    {property.floor_plan && (
                      <div style={styles.parsedItem}>
                        <span style={styles.parsedLabel}>間取り</span>
                        <span style={styles.parsedValue}>{property.floor_plan}</span>
                      </div>
                    )}
                    {property.management_company && (
                      <div style={styles.parsedItem}>
                        <span style={styles.parsedLabel}>管理会社</span>
                        <span style={styles.parsedValue}>{property.management_company}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ADチェックと物確開始 */}
          {parsedData && parsedData.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <div style={styles.checkboxGroup}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={checkAD}
                    onChange={(e) => setCheckAD(e.target.checked)}
                    disabled={isLoading}
                  />
                  <span style={{ marginLeft: 8 }}>AD有りのみ表示</span>
                </label>
              </div>

              {isLoading ? (
                <button
                  onClick={handleCancel}
                  style={{
                    ...styles.button,
                    backgroundColor: '#6b7280',
                    marginTop: '12px'
                  }}
                >
                  キャンセル
                </button>
              ) : (
                <button
                  onClick={handleBukaku}
                  disabled={!parsedData?.[selectedPropertyIndex]?.property_name}
                  style={{
                    ...styles.button,
                    marginTop: '12px',
                    opacity: parsedData?.[selectedPropertyIndex]?.property_name ? 1 : 0.6,
                    cursor: parsedData?.[selectedPropertyIndex]?.property_name ? 'pointer' : 'not-allowed'
                  }}
                >
                  「{parsedData?.[selectedPropertyIndex]?.property_name || '物件'}」を物確
                </button>
              )}
            </div>
          )}
        </section>


        {/* リアルタイムプレビュー */}
        {isLoading && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>実行状況</h2>

            {/* ステータスメッセージ */}
            <div style={styles.statusBar}>
              <div style={styles.spinner}></div>
              <span>{statusMessage}</span>
            </div>

            {/* スクリーンショットプレビュー */}
            <div style={styles.previewContainer}>
              {screenshot ? (
                <img
                  src={screenshot}
                  alt="実行中の画面"
                  style={styles.previewImage}
                />
              ) : (
                <div style={styles.previewPlaceholder}>
                  <p>ブラウザを起動中...</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* エラー表示 */}
        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        {/* 結果表示 */}
        {results && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>物確結果</h2>

            <div style={styles.resultSummary}>
              <span style={styles.badge}>
                {results.platform.toUpperCase()}
              </span>
              <span>
                {results.results.length}件の結果
              </span>
            </div>

            {results.results.length === 0 ? (
              <p style={{ color: '#6b7280' }}>該当する物件が見つかりませんでした</p>
            ) : (
              results.results.map((result, index) => (
                <div key={index} style={styles.resultCard}>
                  <div style={styles.resultHeader}>
                    <span style={{
                      ...styles.statusBadge,
                      backgroundColor: result.status === 'available' ? '#10b981' :
                        result.status === 'applied' ? '#f59e0b' : '#ef4444'
                    }}>
                      {result.status === 'available' ? '募集中' :
                        result.status === 'applied' ? '申込あり' : '確認不可'}
                    </span>
                  </div>

                  <div style={styles.resultDetails}>
                    <div style={styles.detailItem}>
                      <span style={styles.detailLabel}>AD</span>
                      <span style={styles.detailValue}>
                        {result.has_ad ? '✓ あり' : '－ なし'}
                      </span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.detailLabel}>内見</span>
                      <span style={styles.detailValue}>
                        {result.viewing_available ? '✓ 可' : '要確認'}
                      </span>
                    </div>
                  </div>

                  <details style={styles.rawText}>
                    <summary>詳細情報</summary>
                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                      {result.raw_text}
                    </pre>
                  </details>
                </div>
              ))
            )}

            {/* Notion記録ボタン */}
            <div style={{ marginTop: '20px' }}>
              <button
                onClick={handleNotionRecord}
                disabled={isRecording}
                style={{
                  ...styles.button,
                  backgroundColor: '#10b981',
                  opacity: isRecording ? 0.6 : 1,
                  cursor: isRecording ? 'not-allowed' : 'pointer'
                }}
              >
                {isRecording ? 'Notionに記録中...' : 'Notionに記録'}
              </button>

              {notionResult && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  borderRadius: '6px',
                  backgroundColor: notionResult.success ? '#f0fdf4' : '#fef2f2',
                  color: notionResult.success ? '#166534' : '#dc2626',
                  border: `1px solid ${notionResult.success ? '#86efac' : '#fecaca'}`
                }}>
                  {notionResult.success ? (
                    <>
                      Notionに記録しました
                      {notionResult.url && (
                        <a
                          href={notionResult.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ marginLeft: '8px', color: '#0369a1' }}
                        >
                          開く
                        </a>
                      )}
                    </>
                  ) : (
                    <>エラー: {notionResult.error}</>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <footer style={styles.footer}>
        <p>© 2025 物確アプリ</p>
      </footer>

      {/* スピナーアニメーション用CSS */}
      <style jsx global>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f5f5f5'
  },
  header: {
    backgroundColor: '#1f2937',
    color: 'white',
    padding: '24px',
    textAlign: 'center'
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 'bold'
  },
  subtitle: {
    margin: '8px 0 0',
    opacity: 0.8,
    fontSize: '14px'
  },
  main: {
    flex: 1,
    padding: '24px',
    maxWidth: '800px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box'
  },
  section: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  sectionTitle: {
    margin: '0 0 16px',
    fontSize: '18px',
    fontWeight: '600'
  },
  description: {
    color: '#6b7280',
    fontSize: '14px',
    marginBottom: '16px'
  },
  inputGroup: {
    marginBottom: '16px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontWeight: '500',
    fontSize: '14px'
  },
  input: {
    width: '100%',
    padding: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    boxSizing: 'border-box'
  },
  checkboxGroup: {
    marginBottom: '16px'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer'
  },
  button: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#f97316',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  error: {
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '24px',
    border: '1px solid #fecaca'
  },
  // マイソク解析用スタイル
  uploadArea: {
    marginBottom: '16px'
  },
  dropZone: {
    border: '2px dashed #d1d5db',
    borderRadius: '8px',
    padding: '32px',
    textAlign: 'center',
    cursor: 'pointer',
    backgroundColor: '#fafafa',
    color: '#6b7280'
  },
  parsedDataBox: {
    marginTop: '16px',
    padding: '16px',
    backgroundColor: '#f0fdf4',
    borderRadius: '8px',
    border: '1px solid #86efac'
  },
  parsedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px'
  },
  parsedItem: {
    display: 'flex',
    flexDirection: 'column'
  },
  parsedLabel: {
    fontSize: '12px',
    color: '#6b7280'
  },
  parsedValue: {
    fontSize: '14px',
    fontWeight: '500'
  },
  // リアルタイムプレビュー用スタイル
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#f0f9ff',
    borderRadius: '6px',
    color: '#0369a1'
  },
  spinner: {
    width: '20px',
    height: '20px',
    border: '3px solid #e0e0e0',
    borderTopColor: '#0369a1',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  previewContainer: {
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: '#1f2937',
    aspectRatio: '16/9'
  },
  previewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain'
  },
  previewPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#9ca3af',
    minHeight: '200px'
  },
  resultSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px'
  },
  badge: {
    backgroundColor: '#3b82f6',
    color: 'white',
    padding: '4px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600'
  },
  resultCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px'
  },
  resultHeader: {
    marginBottom: '12px'
  },
  statusBadge: {
    color: 'white',
    padding: '4px 12px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500'
  },
  resultDetails: {
    display: 'flex',
    gap: '24px',
    marginBottom: '12px'
  },
  detailItem: {
    display: 'flex',
    flexDirection: 'column'
  },
  detailLabel: {
    fontSize: '12px',
    color: '#6b7280'
  },
  detailValue: {
    fontSize: '14px',
    fontWeight: '500'
  },
  rawText: {
    fontSize: '14px',
    color: '#6b7280'
  },
  footer: {
    backgroundColor: '#1f2937',
    color: 'white',
    padding: '16px',
    textAlign: 'center',
    fontSize: '14px'
  }
};
