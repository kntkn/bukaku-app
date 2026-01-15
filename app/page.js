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
  const fileInputRef = useRef(null);

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
        setParsedData(data.data);
        // 物件名が取得できたら自動入力
        if (data.data.property_name) {
          setPropertyName(data.data.property_name);
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
    if (!propertyName.trim()) {
      setError('物件名を入力してください');
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
          propertyName: propertyName.trim(),
          checkAD,
          platform: 'itandi'
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
          {parsedData && (
            <div style={styles.parsedDataBox}>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>抽出された物件情報</h3>
              <div style={styles.parsedGrid}>
                {parsedData.property_name && (
                  <div style={styles.parsedItem}>
                    <span style={styles.parsedLabel}>物件名</span>
                    <span style={styles.parsedValue}>{parsedData.property_name}</span>
                  </div>
                )}
                {parsedData.address && (
                  <div style={styles.parsedItem}>
                    <span style={styles.parsedLabel}>住所</span>
                    <span style={styles.parsedValue}>{parsedData.address}</span>
                  </div>
                )}
                {parsedData.rent && (
                  <div style={styles.parsedItem}>
                    <span style={styles.parsedLabel}>賃料</span>
                    <span style={styles.parsedValue}>{parsedData.rent}</span>
                  </div>
                )}
                {parsedData.floor_plan && (
                  <div style={styles.parsedItem}>
                    <span style={styles.parsedLabel}>間取り</span>
                    <span style={styles.parsedValue}>{parsedData.floor_plan}</span>
                  </div>
                )}
                {parsedData.management_company && (
                  <div style={styles.parsedItem}>
                    <span style={styles.parsedLabel}>管理会社</span>
                    <span style={styles.parsedValue}>{parsedData.management_company}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 検索フォーム */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>物件検索</h2>

          <div style={styles.inputGroup}>
            <label style={styles.label}>物件名</label>
            <input
              type="text"
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
              placeholder="例: パームス代々木"
              style={styles.input}
              disabled={isLoading}
            />
          </div>

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
                backgroundColor: '#6b7280'
              }}
            >
              キャンセル
            </button>
          ) : (
            <button
              onClick={handleBukaku}
              style={styles.button}
            >
              物確開始
            </button>
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
