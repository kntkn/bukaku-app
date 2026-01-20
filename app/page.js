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
  const [bukakuResults, setBukakuResults] = useState([]); // 全物件の物確結果
  const [currentBukakuIndex, setCurrentBukakuIndex] = useState(-1); // 現在物確中の物件インデックス
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

  // PDFファイル選択時に自動で解析開始
  const handlePdfSelect = async (file) => {
    if (!file) return;

    setPdfFile(file);
    setIsParsing(true);
    setError(null);
    setParsedData(null);
    setBukakuResults([]);
    setCurrentBukakuIndex(-1);

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const response = await fetch(`${BACKEND_URL}/api/maisoku/parse`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        const properties = Array.isArray(data.data) ? data.data : [data.data];
        setParsedData(properties);
      } else {
        setError(data.error || 'マイソク解析に失敗しました');
      }
    } catch (err) {
      setError('通信エラーが発生しました');
    } finally {
      setIsParsing(false);
    }
  };

  // Notionに単一物件の結果を保存
  const saveToNotion = async (property, results) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/notion/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName: property.property_name,
          results: results || [],
          platform: 'itandi',
          parsedData: property
        })
      });
      const data = await response.json();
      return data.success;
    } catch (err) {
      console.error('Notion保存エラー:', err);
      return false;
    }
  };

  // 単一物件の物確を実行（Promise返却）
  const checkSingleProperty = (property, index) => {
    return new Promise((resolve) => {
      setCurrentBukakuIndex(index);
      setStatusMessage(`${property.property_name || `物件${index + 1}`} を確認中...`);
      setScreenshot(null);

      fetch(`${BACKEND_URL}/api/bukaku/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName: property.property_name?.trim(),
          checkAD,
          platform: 'itandi',
          managementCompany: property.management_company
        })
      })
        .then(res => res.json())
        .then(startData => {
          if (!startData.success) {
            resolve({ property, success: false, error: startData.error, notionSaved: false });
            return;
          }

          const { sessionId } = startData;
          const ws = new WebSocket(WS_URL);

          ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'start_bukaku', sessionId }));
          };

          ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'status') {
              setStatusMessage(`[${index + 1}/${parsedData.length}] ${data.message}`);
            } else if (data.type === 'screenshot') {
              setScreenshot(data.image);
            } else if (data.type === 'result') {
              ws.close();
              // 自動でNotionに保存
              setStatusMessage(`[${index + 1}/${parsedData.length}] Notionに保存中...`);
              const notionSaved = await saveToNotion(property, data.results);
              resolve({ property, success: data.success, results: data.results || [], error: data.error, notionSaved });
            } else if (data.type === 'error') {
              ws.close();
              resolve({ property, success: false, error: data.message, notionSaved: false });
            }
          };

          ws.onerror = () => {
            resolve({ property, success: false, error: 'WebSocket接続エラー', notionSaved: false });
          };
        })
        .catch(err => {
          resolve({ property, success: false, error: err.message, notionSaved: false });
        });
    });
  };

  // 全物件を順次物確
  const handleBukakuAll = async () => {
    if (!parsedData || parsedData.length === 0) {
      setError('物件情報がありません');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setBukakuResults([]);
    setScreenshot(null);

    const allResults = [];

    for (let i = 0; i < parsedData.length; i++) {
      const property = parsedData[i];
      if (!property.property_name?.trim()) continue;

      const result = await checkSingleProperty(property, i);
      allResults.push(result);
      setBukakuResults([...allResults]);
    }

    setIsLoading(false);
    setCurrentBukakuIndex(-1);
    setStatusMessage('');
    setScreenshot(null);
  };

  // 旧handleBukaku（互換性のため残す）
  const handleBukaku = async () => {
    handleBukakuAll();
  };

  // WebSocket接続用（旧コード - 削除予定）
  const handleBukakuLegacy = async () => {
    const selectedProperty = parsedData?.[0];
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
        {/* マイソクアップロード */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>マイソクをアップロード</h2>
          <p style={styles.description}>
            PDFをアップロードすると自動で解析し、全物件の空室確認を行います
          </p>

          <div style={styles.uploadArea}>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => handlePdfSelect(e.target.files[0])}
              ref={fileInputRef}
              style={{ display: 'none' }}
              disabled={isParsing || isLoading}
            />
            <div
              onClick={() => !isParsing && !isLoading && fileInputRef.current?.click()}
              style={{
                ...styles.dropZone,
                opacity: (isParsing || isLoading) ? 0.6 : 1,
                cursor: (isParsing || isLoading) ? 'not-allowed' : 'pointer'
              }}
            >
              {isParsing ? (
                <p>解析中...</p>
              ) : pdfFile ? (
                <p>{pdfFile.name}</p>
              ) : (
                <p>クリックしてPDFを選択</p>
              )}
            </div>
          </div>

          {/* 解析結果表示 */}
          {parsedData && parsedData.length > 0 && (
            <div style={styles.parsedDataBox}>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>
                抽出された物件 ({parsedData.length}件)
              </h3>
              {parsedData.map((property, index) => {
                // 物確結果があれば取得
                const bukakuResult = bukakuResults.find(r => r.property?.property_name === property.property_name);
                const isChecking = currentBukakuIndex === index;

                return (
                  <div
                    key={index}
                    style={{
                      marginBottom: index < parsedData.length - 1 ? '8px' : 0,
                      padding: '10px 12px',
                      borderRadius: '6px',
                      border: isChecking ? '2px solid #3b82f6' : '1px solid #d1d5db',
                      backgroundColor: bukakuResult?.success ? '#f0fdf4' : isChecking ? '#eff6ff' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>
                        {property.property_name || `物件 ${index + 1}`}
                      </span>
                      {isChecking && (
                        <span style={{ fontSize: 12, color: '#3b82f6' }}>確認中...</span>
                      )}
                      {bukakuResult && (
                        <span style={{
                          fontSize: 12,
                          color: bukakuResult.success ? '#10b981' : '#ef4444'
                        }}>
                          {bukakuResult.success ? `${bukakuResult.results?.length || 0}件` : 'エラー'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                      {property.rent} / {property.floor_plan || '-'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 物確開始ボタン */}
          {parsedData && parsedData.length > 0 && !isLoading && bukakuResults.length === 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={styles.checkboxGroup}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={checkAD}
                    onChange={(e) => setCheckAD(e.target.checked)}
                  />
                  <span style={{ marginLeft: 8 }}>AD有りのみ表示</span>
                </label>
              </div>
              <button
                onClick={handleBukakuAll}
                style={{
                  ...styles.button,
                  marginTop: '12px'
                }}
              >
                全{parsedData.length}件を物確開始
              </button>
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

        {/* 物確結果表示 */}
        {bukakuResults.length > 0 && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>
              物確結果
              {!isLoading && (
                <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 8, color: '#6b7280' }}>
                  ({bukakuResults.filter(r => r.success).length}/{bukakuResults.length}件完了)
                </span>
              )}
            </h2>

            {bukakuResults.map((bukaku, index) => (
              <div key={index} style={{
                ...styles.resultCard,
                borderColor: bukaku.success ? '#10b981' : '#ef4444'
              }}>
                <div style={styles.resultHeader}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>
                    {bukaku.property?.property_name || `物件${index + 1}`}
                  </span>
                  {!bukaku.success && (
                    <span style={{ ...styles.statusBadge, backgroundColor: '#ef4444' }}>
                      エラー
                    </span>
                  )}
                </div>

                {bukaku.success && bukaku.results?.length > 0 ? (
                  bukaku.results.map((result, rIdx) => (
                    <div key={rIdx} style={{
                      padding: '8px',
                      marginTop: '8px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '4px'
                    }}>
                      <span style={{
                        ...styles.statusBadge,
                        backgroundColor: result.status === 'available' ? '#10b981' :
                          result.status === 'applied' ? '#f59e0b' : '#ef4444'
                      }}>
                        {result.status === 'available' ? '募集中' :
                          result.status === 'applied' ? '申込あり' : '確認不可'}
                      </span>
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
                    </div>
                  ))
                ) : bukaku.success ? (
                  <p style={{ color: '#6b7280', marginTop: 8 }}>該当なし</p>
                ) : (
                  <p style={{ color: '#ef4444', marginTop: 8 }}>{bukaku.error}</p>
                )}
              </div>
            ))}

            {/* Notion確認リンク（物確完了後に表示） */}
            {!isLoading && (
              <div style={{ marginTop: '20px' }}>
                <div style={{
                  padding: '12px',
                  borderRadius: '6px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #86efac',
                  marginBottom: '12px'
                }}>
                  <span style={{ color: '#166534' }}>
                    {bukakuResults.filter(r => r.notionSaved).length}/{bukakuResults.length}件をNotionに保存しました
                  </span>
                </div>
                <a
                  href="https://www.notion.so/2e21c1974dad81bfad4ace49ca030e9e"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...styles.button,
                    backgroundColor: '#10b981',
                    display: 'block',
                    textAlign: 'center',
                    textDecoration: 'none'
                  }}
                >
                  Notionで確認する
                </a>
              </div>
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
