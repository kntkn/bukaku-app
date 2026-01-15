/**
 * 物確バックエンドサーバー
 * Renderで動作するExpressサーバー
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: '物確バックエンド',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// 物確API
app.post('/api/bukaku', async (req, res) => {
  const { propertyName, checkAD, platform = 'itandi' } = req.body;

  if (!propertyName) {
    return res.status(400).json({
      success: false,
      error: '物件名が必要です'
    });
  }

  console.log(`[物確] 開始: ${propertyName} (platform: ${platform})`);

  try {
    // 動的インポート
    const { bukaku } = await import('../src/itandi-bukaku.js');

    const result = await bukaku(propertyName, { headless: true });

    // ADフィルタ
    if (checkAD && result.success && result.results) {
      result.results = result.results.filter(r => r.has_ad);
    }

    console.log(`[物確] 完了: ${result.results?.length || 0}件`);

    res.json(result);
  } catch (error) {
    console.error('[物確] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 対応プラットフォーム一覧
app.get('/api/platforms', (req, res) => {
  res.json({
    platforms: [
      { id: 'itandi', name: 'ITANDI BB', status: 'active' },
      { id: 'ierabu', name: 'いえらぶ', status: 'planned' }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`物確バックエンドサーバー起動: http://localhost:${PORT}`);
});
