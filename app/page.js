'use client';

import { useState, useRef, useEffect } from 'react';

// バックエンドURL
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://bukaku-backend.onrender.com';
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

export default function Home() {
  const [propertyName, setPropertyName] = useState('');
  const [activeTab, setActiveTab] = useState('ad'); // 'ad' | 'noAd' - ADタブ切り替え
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  // リアルタイムプレビュー用のstate
  const [screenshot, setScreenshot] = useState(null);
  const [parallelScreenshots, setParallelScreenshots] = useState([]); // 並列検索用（最大4枚）
  const [statusMessage, setStatusMessage] = useState('');
  const wsRef = useRef(null);

  // マイソク解析用のstate
  const [pdfFile, setPdfFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [parsingStep, setParsingStep] = useState(0); // 解析ステップ（0-4）
  const [bukakuResults, setBukakuResults] = useState([]); // 全物件の物確結果
  const [currentBukakuIndex, setCurrentBukakuIndex] = useState(-1); // 現在物確中の物件インデックス
  const fileInputRef = useRef(null);

  // スマート物確用のstate
  const [groupingResult, setGroupingResult] = useState(null); // グルーピング結果
  const [smartProgress, setSmartProgress] = useState(null); // 実行進捗

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

  // 解析ステップのラベル
  const parsingSteps = [
    { label: 'PDFを読み込み中', icon: '📄' },
    { label: 'ページを解析中', icon: '🔍' },
    { label: '物件情報を抽出中', icon: '🏠' },
    { label: '管理会社を特定中', icon: '🏢' },
    { label: 'データを整理中', icon: '✨' }
  ];

  // PDFファイル選択時に自動で解析開始
  const handlePdfSelect = async (file) => {
    if (!file) return;

    setPdfFile(file);
    setIsParsing(true);
    setParsingStep(0);
    setError(null);
    setParsedData(null);
    setBukakuResults([]);
    setCurrentBukakuIndex(-1);

    // ステップを段階的に進めるタイマー
    const stepInterval = setInterval(() => {
      setParsingStep(prev => Math.min(prev + 1, parsingSteps.length - 1));
    }, 3000); // 3秒ごとに次のステップへ

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
      clearInterval(stepInterval);
      setIsParsing(false);
      setParsingStep(0);
    }
  };

  // Notionに単一物件の結果を保存
  const saveToNotion = async (property, results, platform = 'unknown') => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/notion/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName: property.property_name,
          roomNumber: property.room_number || '',
          results: results || [],
          platform,
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

  // 検索戦略を取得（対応表確認）
  const getStrategy = async (managementCompany) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/bukaku/strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managementCompany })
      });
      return await response.json();
    } catch (err) {
      return { success: false, strategy: 'parallel', platforms: [] };
    }
  };

  // 単一プラットフォーム検索（WebSocket、リアルタイムスクリーンショット）
  const searchSinglePlatform = (property, platform, index) => {
    return new Promise((resolve) => {
      setStatusMessage(`[${index + 1}/${parsedData.length}] ${platform}で検索中...`);

      fetch(`${BACKEND_URL}/api/bukaku/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName: property.property_name?.trim(),
          checkAD,
          platform,
          managementCompany: property.management_company
        })
      })
        .then(res => res.json())
        .then(startData => {
          if (!startData.success) {
            resolve({ success: false, error: startData.error, platform });
            return;
          }

          const { sessionId } = startData;
          const ws = new WebSocket(WS_URL);

          ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'start_bukaku', sessionId }));
          };

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'status') {
              setStatusMessage(`[${index + 1}/${parsedData.length}] ${data.message}`);
            } else if (data.type === 'screenshot') {
              setScreenshot(data.image);
            } else if (data.type === 'result') {
              ws.close();
              resolve({ success: data.success, results: data.results || [], platform });
            } else if (data.type === 'error') {
              ws.close();
              resolve({ success: false, error: data.message, platform });
            }
          };

          ws.onerror = () => {
            resolve({ success: false, error: 'WebSocket接続エラー', platform });
          };
        })
        .catch(err => {
          resolve({ success: false, error: err.message, platform });
        });
    });
  };

  // 並列検索（WebSocket、4ブラウザ同時リアルタイムスクリーンショット）
  const searchParallel = (property, index, platforms) => {
    return new Promise((resolve) => {
      setStatusMessage(`[${index + 1}/${parsedData.length}] 複数プラットフォームで並列検索中...`);
      setScreenshot(null);
      setParallelScreenshots([]);

      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'start_parallel',
          propertyName: property.property_name?.trim(),
          managementCompany: property.management_company,
          checkAD,
          platforms
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'status') {
          setStatusMessage(`[${index + 1}/${parsedData.length}] ${data.message}`);
        } else if (data.type === 'screenshots') {
          // 複数スクリーンショットを更新
          setParallelScreenshots(data.images);
        } else if (data.type === 'result') {
          ws.close();
          setParallelScreenshots([]);

          if (data.success && data.hits?.length > 0) {
            const allResults = data.hits.flatMap(hit => hit.results.map(r => ({
              ...r,
              platform: hit.platformId
            })));
            resolve({
              success: true,
              results: allResults,
              platform: data.hits.map(h => h.platformId).join(', '),
              strategy: 'parallel'
            });
          } else {
            resolve({
              success: true,
              results: [],
              platform: 'parallel',
              strategy: 'parallel'
            });
          }
        } else if (data.type === 'error') {
          ws.close();
          setParallelScreenshots([]);
          resolve({ success: false, error: data.message, platform: 'parallel' });
        }
      };

      ws.onerror = () => {
        setParallelScreenshots([]);
        resolve({ success: false, error: 'WebSocket接続エラー', platform: 'parallel' });
      };
    });
  };

  // 単一物件の物確を実行（戦略に基づいて単一/並列を切り替え）
  const checkSingleProperty = async (property, index) => {
    setCurrentBukakuIndex(index);
    setStatusMessage(`${property.property_name || `物件${index + 1}`} の検索戦略を確認中...`);
    setScreenshot(null);

    // 1. 対応表を確認して検索戦略を取得
    const strategyResult = await getStrategy(property.management_company);
    console.log(`[戦略] ${property.management_company || '不明'} → ${strategyResult.strategy}`);

    let searchResult;

    if (strategyResult.strategy === 'single' && strategyResult.platforms?.length > 0) {
      // 2a. 対応表にヒット → 単一プラットフォーム検索
      const platform = strategyResult.platforms[0];
      setStatusMessage(`[${index + 1}/${parsedData.length}] 対応表ヒット: ${platform}で検索`);
      searchResult = await searchSinglePlatform(property, platform, index);
    } else {
      // 2b. 対応表になし → 並列検索
      setStatusMessage(`[${index + 1}/${parsedData.length}] 対応表なし: 並列検索開始`);
      searchResult = await searchParallel(property, index, strategyResult.platforms || []);
    }

    // 3. Notionに保存
    setStatusMessage(`[${index + 1}/${parsedData.length}] Notionに保存中...`);
    const notionSaved = await saveToNotion(property, searchResult.results, searchResult.platform);

    return {
      property,
      success: searchResult.success,
      results: searchResult.results || [],
      error: searchResult.error,
      platform: searchResult.platform,
      strategy: strategyResult.strategy,
      notionSaved
    };
  };

  // スマート物確（プラットフォーム別グルーピング＋バッチ実行）
  // mode: 'adOnly' = AD物件のみ, 'all' = 全物件
  const handleSmartBukaku = (mode = 'all') => {
    if (!parsedData || parsedData.length === 0) {
      setError('物件情報がありません');
      return;
    }

    // 対象物件を絞り込み
    const targetProperties = mode === 'adOnly'
      ? parsedData.filter(p => p.ad_info)
      : parsedData;

    if (targetProperties.length === 0) {
      setError('対象となる物件がありません');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setBukakuResults([]);
    setScreenshot(null);
    setParallelScreenshots([]);
    setGroupingResult(null);
    setSmartProgress(null);
    setStatusMessage(`${mode === 'adOnly' ? 'AD物件' : '全物件'}の物確を開始中...`);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'start_smart_bukaku',
        properties: targetProperties,
        checkAD: false // 常にfalse（フィルタは上で実施済み）
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[WebSocket受信]', data.type, data.type === 'screenshot' ? '(画像あり)' : '', data.type === 'screenshots' ? `(${data.images?.length}枚)` : '');

      switch (data.type) {
        case 'grouping_result':
          // グルーピング結果を表示
          setGroupingResult(data.summary);
          setStatusMessage(`グルーピング完了: ${data.summary.known}件が特定済み、${data.summary.unknown}件が並列検索`);
          break;

        case 'status':
          setStatusMessage(data.message);
          break;

        case 'screenshots':
          // 並列検索中のスクリーンショット
          setParallelScreenshots(data.images);
          break;

        case 'screenshot':
          // 単一検索中のスクリーンショット
          setScreenshot(data.image);
          setParallelScreenshots([]);
          break;

        case 'progress':
          // バッチ実行の進捗
          setSmartProgress({
            platform: data.platform || '検索中',
            current: data.current,
            total: data.total
          });
          setStatusMessage(data.platform ? `${data.platform}: ${data.current}/${data.total}件完了` : `${data.current}/${data.total}件完了`);
          break;

        case 'property_result':
          // 個別物件の結果を追加
          setBukakuResults(prev => {
            // 並列検索の場合はhitsからplatformを取得
            let platform = data.platform;
            let results = data.results || [];
            let strategy = 'batch';

            if (data.searchType === 'parallel') {
              strategy = 'parallel';
              if (data.hits && data.hits.length > 0) {
                platform = data.hits.map(h => h.platformId).join(', ');
                results = data.hits.flatMap(h => h.results || []);
              } else {
                platform = '並列検索';
              }
            }

            const newResult = {
              property: data.property || { property_name: data.propertyName },
              success: data.found !== false,
              results,
              error: data.error,
              platform,
              strategy,
              notionSaved: data.notionSaved
            };
            return [...prev, newResult];
          });
          break;

        case 'smart_bukaku_complete':
          // 完了
          setIsLoading(false);
          setStatusMessage('');
          setScreenshot(null);
          setParallelScreenshots([]);
          setSmartProgress(null);
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
  };

  // 全物件を順次物確（旧方式、互換用）
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
    setGroupingResult(null);
    setSmartProgress(null);

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

    // parsedDataから部屋番号を取得（配列の場合は最初の要素）
    const currentData = Array.isArray(parsedData) ? parsedData[0] : parsedData;
    const roomNumber = currentData?.room_number || '';

    try {
      const response = await fetch(`${BACKEND_URL}/api/notion/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName,
          roomNumber,
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
                <div style={{ padding: '8px 0' }}>
                  {/* 現在のステップを表示 */}
                  <div style={{ fontSize: 24, marginBottom: 12 }}>
                    {parsingSteps[parsingStep]?.icon}
                  </div>
                  <p style={{ fontWeight: 500, marginBottom: 8 }}>
                    {parsingSteps[parsingStep]?.label}...
                  </p>
                  {/* プログレスバー */}
                  <div style={{
                    width: '200px',
                    height: '4px',
                    backgroundColor: '#e5e7eb',
                    borderRadius: '2px',
                    margin: '0 auto',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${((parsingStep + 1) / parsingSteps.length) * 100}%`,
                      height: '100%',
                      backgroundColor: '#f97316',
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                  {/* ステップインジケーター */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '6px',
                    marginTop: '12px'
                  }}>
                    {parsingSteps.map((_, idx) => (
                      <div key={idx} style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: idx <= parsingStep ? '#f97316' : '#d1d5db',
                        transition: 'background-color 0.3s ease'
                      }} />
                    ))}
                  </div>
                </div>
              ) : pdfFile ? (
                <p>{pdfFile.name}</p>
              ) : (
                <p>クリックしてPDFを選択</p>
              )}
            </div>
          </div>

          {/* 解析結果表示 - タブUI */}
          {parsedData && parsedData.length > 0 && (() => {
            // ADあり/なしで物件を分類
            const adProperties = parsedData.filter(p => p.ad_info);
            const noAdProperties = parsedData.filter(p => !p.ad_info);
            const displayProperties = activeTab === 'ad' ? adProperties : noAdProperties;

            // 物件カードをレンダリングする関数
            const renderPropertyCard = (property, index) => {
              const bukakuResult = bukakuResults.find(r => r.property?.property_name === property.property_name);
              const isChecking = currentBukakuIndex === index;
              const searchStrategy = property.search_strategy;
              const isDbHit = searchStrategy?.type === 'single' && searchStrategy?.source !== 'not_found';
              const strategyPlatform = searchStrategy?.platforms?.[0] || null;

              return (
                <div
                  key={`${property.property_name}-${index}`}
                  style={{
                    marginBottom: '8px',
                    padding: '12px',
                    borderRadius: '6px',
                    border: isChecking ? '2px solid #3b82f6' : '1px solid #d1d5db',
                    backgroundColor: bukakuResult?.success ? '#f0fdf4' : isChecking ? '#eff6ff' : '#fff',
                  }}
                >
                  {/* 1行目: 物件名/部屋番号 + 物確結果 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {property.property_name || `物件 ${index + 1}`}
                      {property.room_number && (
                        <span style={{ fontWeight: 400, color: '#6b7280' }}> / {property.room_number}</span>
                      )}
                    </span>
                    {isChecking && (
                      <span style={{ fontSize: 12, color: '#3b82f6' }}>確認中...</span>
                    )}
                    {bukakuResult && (
                      <span style={{
                        fontSize: 12,
                        color: bukakuResult.success ? '#10b981' : '#ef4444',
                        fontWeight: 500
                      }}>
                        {bukakuResult.success ? `${bukakuResult.results?.length || 0}件ヒット` : 'エラー'}
                      </span>
                    )}
                  </div>

                  {/* 2行目: 管理会社 */}
                  <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                    {property.management_company || '管理会社不明'}
                  </div>

                  {/* 3行目: ラベル群 */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {property.ad_info ? (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: '#dcfce7', color: '#166534', fontWeight: 500
                      }}>
                        AD: {property.ad_info}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: '#dbeafe', color: '#1e40af'
                      }}>
                        AD不明
                      </span>
                    )}
                    {isDbHit ? (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: '#dcfce7', color: '#166534', fontWeight: 500
                      }}>
                        DB: {strategyPlatform}
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: '#dbeafe', color: '#1e40af'
                      }}>
                        複数検索
                      </span>
                    )}
                    {bukakuResult?.platform && (
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        backgroundColor: '#fef3c7', color: '#92400e'
                      }}>
                        結果: {bukakuResult.platform}
                      </span>
                    )}
                  </div>

                  {/* 4行目: 賃料・間取り */}
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                    {property.rent || '-'} / {property.floor_plan || '-'}
                  </div>
                </div>
              );
            };

            return (
              <div style={styles.parsedDataBox}>
                <h3 style={{ fontSize: 16, marginBottom: 12 }}>
                  抽出された物件 ({parsedData.length}件)
                </h3>

                {/* タブUI */}
                <div style={{ display: 'flex', marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
                  <button
                    onClick={() => setActiveTab('ad')}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      border: 'none',
                      backgroundColor: activeTab === 'ad' ? '#fff' : '#f3f4f6',
                      borderBottom: activeTab === 'ad' ? '2px solid #f97316' : '2px solid transparent',
                      color: activeTab === 'ad' ? '#f97316' : '#6b7280',
                      fontWeight: activeTab === 'ad' ? 600 : 400,
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    ADあり ({adProperties.length}件)
                  </button>
                  <button
                    onClick={() => setActiveTab('noAd')}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      border: 'none',
                      backgroundColor: activeTab === 'noAd' ? '#fff' : '#f3f4f6',
                      borderBottom: activeTab === 'noAd' ? '2px solid #f97316' : '2px solid transparent',
                      color: activeTab === 'noAd' ? '#f97316' : '#6b7280',
                      fontWeight: activeTab === 'noAd' ? 600 : 400,
                      cursor: 'pointer',
                      fontSize: 14
                    }}
                  >
                    ADなし ({noAdProperties.length}件)
                  </button>
                </div>

                {/* 物件一覧 */}
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {displayProperties.length > 0 ? (
                    displayProperties.map((property, index) => renderPropertyCard(property, index))
                  ) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>
                      {activeTab === 'ad' ? 'AD情報のある物件がありません' : 'AD情報のない物件がありません'}
                    </div>
                  )}
                </div>

                {/* 物確ボタン（2つ並べる） */}
                {!isLoading && bukakuResults.length === 0 && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                    <button
                      onClick={() => handleSmartBukaku('adOnly')}
                      disabled={adProperties.length === 0}
                      style={{
                        flex: 1,
                        padding: '14px',
                        backgroundColor: adProperties.length > 0 ? '#f97316' : '#d1d5db',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: adProperties.length > 0 ? 'pointer' : 'not-allowed'
                      }}
                    >
                      AD物件のみ物確 ({adProperties.length})
                    </button>
                    <button
                      onClick={() => handleSmartBukaku('all')}
                      style={{
                        flex: 1,
                        padding: '14px',
                        backgroundColor: '#6b7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      全物件を物確 ({parsedData.length})
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </section>


        {/* リアルタイムプレビュー */}
        {isLoading && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>実行状況</h2>

            {/* グルーピング結果表示 */}
            {groupingResult && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '16px',
                padding: '12px',
                backgroundColor: '#f0fdf4',
                borderRadius: '6px',
                border: '1px solid #86efac'
              }}>
                <span style={{ fontSize: 13, color: '#166534', marginRight: 8 }}>
                  グルーピング:
                </span>
                {Object.entries(groupingResult.platforms || {}).map(([platform, count]) => (
                  <span key={platform} style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor: '#dbeafe',
                    color: '#1e40af'
                  }}>
                    {platform}: {count}件
                  </span>
                ))}
                {groupingResult.unknown > 0 && (
                  <span style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor: '#fef3c7',
                    color: '#92400e'
                  }}>
                    並列検索: {groupingResult.unknown}件
                  </span>
                )}
              </div>
            )}

            {/* 進捗表示 */}
            {smartProgress && (
              <div style={{
                marginBottom: '12px',
                padding: '8px 12px',
                backgroundColor: '#eff6ff',
                borderRadius: '4px',
                border: '1px solid #bfdbfe'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#1e40af', fontWeight: 500 }}>
                    {smartProgress.platform}
                  </span>
                  <span style={{ fontSize: 12, color: '#3b82f6' }}>
                    {smartProgress.current}/{smartProgress.total}件完了
                  </span>
                </div>
                <div style={{
                  marginTop: '6px',
                  height: '4px',
                  backgroundColor: '#dbeafe',
                  borderRadius: '2px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${(smartProgress.current / smartProgress.total) * 100}%`,
                    height: '100%',
                    backgroundColor: '#3b82f6',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            )}

            {/* ステータスメッセージ */}
            <div style={styles.statusBar}>
              <div style={styles.spinner}></div>
              <span>{statusMessage}</span>
            </div>

            {/* 並列検索時: 4画面グリッド表示（PC UIを縮小表示） */}
            {parallelScreenshots.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                backgroundColor: '#1f2937',
                padding: '8px',
                borderRadius: '8px'
              }}>
                {parallelScreenshots.map((item, idx) => (
                  <div key={idx} style={{
                    position: 'relative',
                    aspectRatio: '16 / 9',
                    backgroundColor: '#111827',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <img
                      src={item.image}
                      alt={`${item.platformId}`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        borderRadius: '4px'
                      }}
                    />
                    <span style={{
                      position: 'absolute',
                      top: '4px',
                      left: '4px',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}>
                      {item.platformId}
                    </span>
                  </div>
                ))}
              </div>
            ) : screenshot ? (
              /* 単一検索時: 1画面表示 */
              <div style={styles.previewContainer}>
                <img
                  src={screenshot}
                  alt="実行中の画面"
                  style={styles.previewImage}
                />
              </div>
            ) : (
              <div style={styles.previewContainer}>
                <div style={styles.previewPlaceholder}>
                  <p>ブラウザを起動中...</p>
                </div>
              </div>
            )}
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

            {bukakuResults.map((bukaku, index) => {
              // ステータスを判定
              const getStatusInfo = () => {
                if (!bukaku.success) return { label: 'エラー', color: '#ef4444', bgColor: '#fef2f2' };
                if (!bukaku.results || bukaku.results.length === 0) return { label: '該当なし', color: '#6b7280', bgColor: '#f3f4f6' };
                const firstResult = bukaku.results[0];
                if (firstResult.status === 'available') return { label: '募集中', color: '#166534', bgColor: '#dcfce7' };
                if (firstResult.status === 'applied') return { label: '申込あり', color: '#92400e', bgColor: '#fef3c7' };
                return { label: '確認不可', color: '#dc2626', bgColor: '#fef2f2' };
              };
              const statusInfo = getStatusInfo();

              return (
                <div key={index} style={{
                  ...styles.resultCard,
                  borderColor: bukaku.success ? '#10b981' : '#ef4444'
                }}>
                  {/* タイトル: 物件名 / 部屋番号 */}
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
                    {bukaku.property?.property_name || `物件${index + 1}`}
                    {bukaku.property?.room_number && (
                      <span style={{ fontWeight: 400, color: '#6b7280' }}> / {bukaku.property.room_number}</span>
                    )}
                  </div>

                  {/* ステータスラベル */}
                  <div style={{ marginBottom: 8 }}>
                    <span style={{
                      fontSize: 12,
                      padding: '4px 12px',
                      borderRadius: 4,
                      backgroundColor: statusInfo.bgColor,
                      color: statusInfo.color,
                      fontWeight: 500
                    }}>
                      {statusInfo.label}
                    </span>
                    {bukaku.platform && (
                      <span style={{
                        fontSize: 11,
                        marginLeft: 8,
                        padding: '4px 8px',
                        borderRadius: 4,
                        backgroundColor: '#f3f4f6',
                        color: '#6b7280'
                      }}>
                        {bukaku.platform}
                      </span>
                    )}
                  </div>

                  {/* エラー時のメッセージ */}
                  {!bukaku.success && bukaku.error && (
                    <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{bukaku.error}</p>
                  )}
                </div>
              );
            })}

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
