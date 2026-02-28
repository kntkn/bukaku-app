/**
 * テスト結果のJSON永続化 + レジューム機能
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '../data/results');

class ResultStore {
  constructor(runId = null) {
    this.runId = runId || `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    this.filePath = path.join(RESULTS_DIR, `${this.runId}.json`);
    this.data = {
      runId: this.runId,
      startedAt: new Date().toISOString(),
      updatedAt: null,
      config: {},
      summary: { total: 0, completed: 0, passed: 0, failed: 0, skipped: 0 },
      results: []
    };

    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }

    // 既存データがあればロード（レジューム）
    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        console.log(`[ResultStore] レジューム: ${this.data.results.length}件の既存結果をロード`);
      } catch (e) {
        console.warn(`[ResultStore] 既存ファイル読み込み失敗、新規作成: ${e.message}`);
      }
    }
  }

  setConfig(config) {
    this.data.config = config;
    this._save();
  }

  /**
   * テスト済みのプロパティIDセットを返す（レジューム用）
   */
  getCompletedIds() {
    return new Set(this.data.results.map(r => r.id));
  }

  /**
   * 特定ステージまで完了したIDを返す
   */
  getCompletedForStage(stage) {
    return new Set(
      this.data.results
        .filter(r => r.stages?.[stage]?.status === 'pass' || r.stages?.[stage]?.status === 'fail')
        .map(r => r.id)
    );
  }

  /**
   * 結果を追加 or 更新
   */
  addResult(result) {
    const idx = this.data.results.findIndex(r => r.id === result.id);
    if (idx >= 0) {
      this.data.results[idx] = { ...this.data.results[idx], ...result };
    } else {
      this.data.results.push(result);
    }
    this._updateSummary();
    this._save();
  }

  /**
   * 既存結果のステージを更新
   */
  updateStage(id, stage, stageResult) {
    let entry = this.data.results.find(r => r.id === id);
    if (!entry) {
      entry = { id, stages: {} };
      this.data.results.push(entry);
    }
    if (!entry.stages) entry.stages = {};
    entry.stages[stage] = {
      ...stageResult,
      completedAt: new Date().toISOString()
    };
    this._updateSummary();
    this._save();
  }

  getResult(id) {
    return this.data.results.find(r => r.id === id);
  }

  getAllResults() {
    return this.data.results;
  }

  /**
   * 失敗した結果のみ返す
   */
  getFailedResults(stage = null) {
    return this.data.results.filter(r => {
      if (stage) {
        return r.stages?.[stage]?.status === 'fail';
      }
      return Object.values(r.stages || {}).some(s => s.status === 'fail');
    });
  }

  /**
   * 最新のrunIdを探す（レジューム用）
   */
  static findLatestRun() {
    if (!fs.existsSync(RESULTS_DIR)) return null;
    const files = fs.readdirSync(RESULTS_DIR)
      .filter(f => f.startsWith('run-') && f.endsWith('.json'))
      .sort()
      .reverse();
    return files[0]?.replace('.json', '') || null;
  }

  /**
   * 全runIdをリスト
   */
  static listRuns() {
    if (!fs.existsSync(RESULTS_DIR)) return [];
    return fs.readdirSync(RESULTS_DIR)
      .filter(f => f.startsWith('run-') && f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort()
      .reverse();
  }

  _updateSummary() {
    const results = this.data.results;
    this.data.summary = {
      total: results.length,
      completed: results.filter(r => r.stages && Object.keys(r.stages).length > 0).length,
      passed: results.filter(r => {
        const stages = Object.values(r.stages || {});
        return stages.length > 0 && stages.every(s => s.status === 'pass' || s.status === 'skip');
      }).length,
      failed: results.filter(r => Object.values(r.stages || {}).some(s => s.status === 'fail')).length,
      skipped: results.filter(r => !r.stages || Object.keys(r.stages).length === 0).length
    };
  }

  _save() {
    this.data.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { ResultStore };
