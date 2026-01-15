'use client';

import { useState } from 'react';

export default function Home() {
  const [propertyName, setPropertyName] = useState('');
  const [checkAD, setCheckAD] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleBukaku = async () => {
    if (!propertyName.trim()) {
      setError('物件名を入力してください');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch('/api/bukaku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName: propertyName.trim(),
          checkAD
        })
      });

      const data = await response.json();

      if (data.success) {
        setResults(data);
      } else {
        setError(data.error || data.message || '物確に失敗しました');
      }
    } catch (err) {
      setError('通信エラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>物確アプリ</h1>
        <p style={styles.subtitle}>不動産物件確認の自動化ツール</p>
      </header>

      <main style={styles.main}>
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

          <button
            onClick={handleBukaku}
            disabled={isLoading}
            style={{
              ...styles.button,
              opacity: isLoading ? 0.6 : 1,
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
          >
            {isLoading ? '物確中...' : '物確開始'}
          </button>
        </section>

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

            {results.results.map((result, index) => (
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
            ))}
          </section>
        )}
      </main>

      <footer style={styles.footer}>
        <p>© 2025 物確アプリ</p>
      </footer>
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
    fontWeight: '600'
  },
  error: {
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '24px',
    border: '1px solid #fecaca'
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
