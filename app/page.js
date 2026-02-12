'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// Minimal static starfield (CSS-based, no Canvas animation)
function ParticleField() {
  return null; // Disabled for performance
}

// Lightweight typing effect for success messages
function useTypingAnimation(text, speed = 40) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    if (!text) {
      setDisplayed('');
      return;
    }

    setDisplayed('');
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayed(text.slice(0, i + 1));
        i++;
      } else {
        clearInterval(timer);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed]);

  return displayed;
}

// Cycling text effect for rotating messages (bug fixed)
function useTypingEffect(messages, typeSpeed = 60, pauseTime = 3000) {
  const [displayed, setDisplayed] = useState('');
  const [messageIndex, setMessageIndex] = useState(0);
  const [phase, setPhase] = useState('typing'); // 'typing' | 'pausing'

  useEffect(() => {
    const message = messages[messageIndex];

    if (phase === 'typing') {
      let charIndex = 0;
      const timer = setInterval(() => {
        if (charIndex < message.length) {
          setDisplayed(message.slice(0, charIndex + 1));
          charIndex++;
        } else {
          clearInterval(timer);
          setPhase('pausing');
        }
      }, typeSpeed);
      return () => clearInterval(timer);
    } else {
      const timer = setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % messages.length);
        setDisplayed('');
        setPhase('typing');
      }, pauseTime);
      return () => clearTimeout(timer);
    }
  }, [messageIndex, phase, messages, typeSpeed, pauseTime]);

  return displayed;
}

// Humorous action messages
const ACTION_MESSAGES = {
  typing_name: [
    'typing property name...',
    '物件名、ポチポチ入力中...',
    'キーボード叩いてます',
  ],
  typing_room: [
    'adding room number...',
    '部屋番号も添えて...',
  ],
  searching: [
    'searching...',
    '検索ボタン、ポチッ',
    '結果を待ってます...',
  ],
  checking: [
    'checking results...',
    'AIの目で確認中...',
    '見つかるかな...',
  ],
  parallel_search: [
    'parallel searching...',
    '全サイト同時検索中...',
    'フルスロットルで検索中',
  ],
  saving: [
    'saving to Notion...',
    'Notionにメモメモ...',
  ],
};

function getActionMessage(action) {
  const messages = ACTION_MESSAGES[action] || ACTION_MESSAGES.searching;
  return messages[Math.floor(Math.random() * messages.length)];
}

// Top page cycling messages (outside component to prevent re-render issues)
const TOP_PAGE_MESSAGES = [
  'Scanning property databases...',
  'Cross-referencing 15 platforms...',
  'AI-powered vacancy detection...',
  'Real-time availability check...',
];

// Searching phase cycling messages
const SEARCHING_MESSAGES = [
  '物件名、ポチポチ入力中...',
  'キーボード叩いてます',
  '検索ボタン、ポチッ',
  '結果を待ってます...',
  'AIの目で確認中...',
  '見つかるかな...',
  '全サイト同時検索中...',
  'フルスロットルで検索中',
  'データベース照合中...',
  '空室あるかな...',
  'ブラウザがんばってる',
  '15サイト並列処理中...',
];

// Pipeline steps component (Cover Flow + Spotify歌詞風)
function PipelineSteps({ steps, currentPlatform }) {
  if (!steps || steps.length === 0) return null;

  const activeIndex = steps.findIndex(s => s.platform === currentPlatform || s.id === currentPlatform);
  const activeStep = activeIndex >= 0 ? steps[activeIndex] : null;
  const progressPercent = activeStep && activeStep.count > 0
    ? ((activeStep.completed || 0) / activeStep.count) * 100
    : 0;
  const platformName = activeStep
    ? (activeStep.platform === 'Parallel' || activeStep.platform === '並列検索' ? '並列検索' : activeStep.platform.toUpperCase())
    : '';

  return (
    <div className="w-full flex flex-col items-center">
      {/* ステップインジケーター ● ─ ○ ─ ○ */}
      <div className="flex items-center gap-1 mb-8">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isDone = step.status === 'done';
          return (
            <div key={step.id} className="flex items-center">
              <div className={cn(
                "w-2.5 h-2.5 rounded-full transition-all duration-300",
                isActive ? "bg-violet-400 shadow-lg shadow-violet-400/50" :
                isDone ? "bg-emerald-400" :
                "bg-white/20"
              )} />
              {index < steps.length - 1 && (
                <div className={cn(
                  "w-6 h-px mx-1 transition-all duration-300",
                  isDone ? "bg-emerald-400/50" : "bg-white/10"
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* プラットフォーム名 */}
      <h2 className="text-4xl font-bold text-white mb-6 transition-all duration-500">
        {platformName || 'Preparing...'}
      </h2>

      {/* プログレスバー + 件数 */}
      {activeStep && (
        <div className="flex flex-col items-center">
          <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden mb-3">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-sm font-mono text-white/50">
            {activeStep.completed || 0} / {activeStep.count}
          </span>
        </div>
      )}
    </div>
  );
}

// Success messages (30 patterns)
const SUCCESS_MESSAGES = [
  // 休憩系
  "Go grab a coffee.",
  "Coffee's on us. (Mentally)",
  "Take five.",
  "Breathe.",
  "Stretch a little.",
  "Hydrate yourself.",
  "Look out the window.",
  "You earned a break.",
  "Relax, we're on it.",
  "Snack time?",
  // 解放系
  "You're free now.",
  "Freedom unlocked.",
  "Escape successful.",
  "You're off duty.",
  "Mission handed over.",
  "Weight lifted.",
  "Burden? Gone.",
  "Liberation complete.",
  "You're out.",
  "Clock out.",
  // 任せろ系
  "We got this.",
  "Leave it to us.",
  "We'll take it from here.",
  "Sit back, watch the magic.",
  "AI is on the case.",
  "Machines at work.",
  "We hustle, you chill.",
  "Consider it done.",
  "On it.",
  "Your job here is done."
];

function getRandomSuccessMessage() {
  return SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)];
}

// Platform list
const PLATFORMS = [
  { id: 'atbb', name: 'ATBB' },
  { id: 'itandi', name: 'イタンジ' },
  { id: 'able_hosho', name: 'エイブル保証' },
  { id: 'tanaka_dk', name: '田中DK' },
  { id: 'sumirin', name: '住林' },
  { id: 'seiwa', name: 'セイワ' },
  { id: 'jointproperty', name: 'ジョイント' },
  { id: 'goodworks', name: 'グッドワークス' },
  { id: 'jaamenity', name: 'JAアメニティ' },
  { id: 'shimadahouse', name: '島田ハウス' },
  { id: 'kintarou', name: '金太郎' },
  { id: 'ambition', name: 'アンビション' },
  { id: 'daitoservice', name: '大東サービス' },
  { id: 'ierabu', name: 'いえらぶ' },
  { id: 'essquare', name: 'エススクエア' },
];

// Settings Modal Component
function SettingsModal({ onClose, poolStatus, onStatusUpdate }) {
  const [credentials, setCredentials] = useState({});
  const [loginStatus, setLoginStatus] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch existing credentials on mount
  useEffect(() => {
    const fetchCredentials = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/platforms/credentials`);
        const data = await res.json();
        if (data.success) {
          setCredentials(data.credentials);
        }
      } catch (e) {
        console.error('Failed to fetch credentials:', e);
        // Initialize with empty values
        const initial = {};
        PLATFORMS.forEach(p => {
          initial[p.id] = { username: '', password: '' };
        });
        setCredentials(initial);
      } finally {
        setLoading(false);
      }
    };
    fetchCredentials();
  }, []);

  // Update login status from pool status
  useEffect(() => {
    if (poolStatus?.platforms) {
      const status = {};
      Object.entries(poolStatus.platforms).forEach(([id, data]) => {
        status[id] = data.loggedIn ? 'success' : 'idle';
      });
      setLoginStatus(status);
    }
  }, [poolStatus]);

  const handleLogin = async (platformId) => {
    const cred = credentials[platformId];
    if (!cred.username || !cred.password) return;

    setLoginStatus(prev => ({ ...prev, [platformId]: 'loading' }));

    try {
      const res = await fetch(`${BACKEND_URL}/api/platforms/${platformId}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cred),
      });
      const data = await res.json();

      if (data.success) {
        setLoginStatus(prev => ({ ...prev, [platformId]: 'success' }));
        onStatusUpdate();
      } else {
        setLoginStatus(prev => ({ ...prev, [platformId]: 'error' }));
      }
    } catch {
      setLoginStatus(prev => ({ ...prev, [platformId]: 'error' }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl glass border border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-medium text-white">Platform Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[60vh] p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="w-6 h-6 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : (
          <div className="space-y-3">
            {PLATFORMS.map((platform) => (
              <div
                key={platform.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5"
              >
                {/* Platform Name */}
                <div className="w-28 shrink-0">
                  <span className="text-sm font-medium text-white/80">{platform.name}</span>
                </div>

                {/* ID Input */}
                <input
                  type="text"
                  placeholder="ID"
                  value={credentials[platform.id]?.username || ''}
                  onChange={(e) => setCredentials(prev => ({
                    ...prev,
                    [platform.id]: { ...prev[platform.id], username: e.target.value }
                  }))}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
                />

                {/* Password Input */}
                <input
                  type="password"
                  placeholder="Password"
                  value={credentials[platform.id]?.password || ''}
                  onChange={(e) => setCredentials(prev => ({
                    ...prev,
                    [platform.id]: { ...prev[platform.id], password: e.target.value }
                  }))}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
                />

                {/* Login Button / Status */}
                <div className="w-24 shrink-0">
                  {loginStatus[platform.id] === 'success' ? (
                    <div className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="text-xs font-medium">済</span>
                    </div>
                  ) : loginStatus[platform.id] === 'loading' ? (
                    <div className="flex items-center justify-center px-3 py-2 rounded-lg bg-white/5">
                      <svg className="w-4 h-4 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  ) : loginStatus[platform.id] === 'error' ? (
                    <button
                      onClick={() => handleLogin(platform.id)}
                      className="w-full px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
                    >
                      Retry
                    </button>
                  ) : (
                    <button
                      onClick={() => handleLogin(platform.id)}
                      className="w-full px-3 py-2 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-white/10">
          <p className="text-xs text-white/40">
            {poolStatus?.loggedIn || 0} / {PLATFORMS.length} platforms connected
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/10 text-sm font-medium text-white hover:bg-white/20 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [poolStatus, setPoolStatus] = useState(null);
  const [isPoolInitializing, setIsPoolInitializing] = useState(false);

  // 認証チェック
  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      // SSRでは実行しない
      if (typeof window === 'undefined') return;

      const token = localStorage.getItem('bukkaku_token');
      if (!token) {
        if (mounted) {
          setAuthChecking(false);
          router.replace('/login');
        }
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();

        if (!mounted) return;

        if (data.success) {
          setIsAuthenticated(true);
          setCurrentUser(data.user);
          setAuthChecking(false);
        } else {
          localStorage.removeItem('bukkaku_token');
          localStorage.removeItem('bukkaku_user');
          setAuthChecking(false);
          router.replace('/login');
        }
      } catch {
        if (mounted) {
          setAuthChecking(false);
          router.replace('/login');
        }
      }
    };

    checkAuth();

    return () => { mounted = false; };
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('bukkaku_token');
    localStorage.removeItem('bukkaku_user');
    router.push('/login');
  };

  const [currentPhase, setCurrentPhase] = useState('idle');
  const [parsingProgress, setParsingProgress] = useState({ parsed: 0, total: 0 });
  const [bukakuProgress, setBukakuProgress] = useState({ completed: 0, total: 0, found: 0 });
  const [parsedProperties, setParsedProperties] = useState([]);
  const [bukakuResults, setBukakuResults] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState(null);

  // 新UI用のstate
  const [pipelineSteps, setPipelineSteps] = useState([]);
  const [currentPlatform, setCurrentPlatform] = useState(null);
  const [currentProperty, setCurrentProperty] = useState(null);
  const [currentActionMessage, setCurrentActionMessage] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const [propertyQueue, setPropertyQueue] = useState([]);  // 検索待ちの物件キュー
  const [completedProperties, setCompletedProperties] = useState([]);  // 検索完了した物件
  const [matchingProgress, setMatchingProgress] = useState(null); // { current, total, propertyName }

  // Typewriter effect for success message
  const typedSuccessMessage = useTypingAnimation(successMessage, 40);

  // Typewriter effect for real-time action message from backend
  const typedActionMessage = useTypingAnimation(currentActionMessage, 30);

  // 残り時間カウントダウン
  const isCountingDown = remainingSeconds !== null && remainingSeconds > 0;
  useEffect(() => {
    if (!isCountingDown) return;
    const timer = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev === null || prev <= 0) return prev;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isCountingDown]);

  // 時間フォーマット
  const formatTime = (seconds) => {
    if (seconds === null) return '計算中...';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  };

  const fileInputRef = useRef(null);
  const wsRef = useRef(null);
  const pipelineStepsRef = useRef([]);
  const currentPlatformRef = useRef(null);

  const typingText = useTypingEffect(TOP_PAGE_MESSAGES, 60, 3000);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  useEffect(() => {
    fetchPoolStatus();
  }, []);

  const fetchPoolStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/pool/status`);
      setPoolStatus(await res.json());
    } catch (e) {
      console.error('Pool status error:', e);
    }
  };

  const initializePool = async () => {
    setIsPoolInitializing(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/pool/init`, { method: 'POST' });
      setPoolStatus(await res.json());
    } catch (e) {
      setError('Failed to initialize browser pool');
    } finally {
      setIsPoolInitializing(false);
    }
  };

  const handlePdfSelect = async (files) => {
    const fileList = Array.isArray(files) ? files : Array.from(files);
    const pdfFiles = fileList.filter(f => f.type === 'application/pdf');
    if (pdfFiles.length === 0) return;

    // Set random success message with typewriter effect
    setSuccessMessage(getRandomSuccessMessage());

    // Reset all state
    setError(null);
    setParsedProperties([]);
    setBukakuResults([]);
    setParsingProgress({ parsed: 0, total: 0 });
    setBukakuProgress({ completed: 0, total: 0, found: 0 });
    setPipelineSteps([]);
    setCurrentPlatform(null);
    setCurrentProperty(null);
    setCurrentActionMessage('');
    setRemainingSeconds(null);
    setMatchingProgress(null);
    setIsLoading(true);
    setCurrentPhase('parsing');

    const readFile = (file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result.split(',')[1]);
      reader.readAsDataURL(file);
    });

    const pdfBase64List = await Promise.all(pdfFiles.map(readFile));
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'start_pipeline_bukaku',
        pdfBase64List,
        useFastSearch: true
      }));
    };

    ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
    ws.onerror = () => {
      setError('Connection error');
      setIsLoading(false);
      setCurrentPhase('idle');
    };
    ws.onclose = () => { wsRef.current = null; };
  };

  const handleMessage = (data) => {
    switch (data.type) {
      case 'parsing_progress':
        setParsingProgress({ parsed: data.parsed, total: data.total });
        setStatusMessage(`Parsing ${data.parsed}/${data.total}`);
        break;
      case 'property_parsed':
        setParsedProperties(prev => [...prev, data.property]);
        break;
      case 'parsing_complete':
        setCurrentPhase('searching');
        break;
      case 'search_plan': {
        // 検索計画を受信 - 各物件にstatus:'searching'を付与
        const steps = (data.steps || []).map(step => ({
          ...step,
          properties: (step.properties || []).map(p => ({ ...p, status: 'searching' }))
        }));
        setPipelineSteps(steps);
        pipelineStepsRef.current = steps;
        setRemainingSeconds(data.estimatedSeconds);
        setMatchingProgress(null);
        if (steps.length > 0) {
          setCurrentPlatform(steps[0].id);
          currentPlatformRef.current = steps[0].id;
        }
        break;
      }
      case 'matching_progress':
        // 管理会社→プラットフォーム照合の進捗
        setMatchingProgress({
          current: data.current,
          total: data.total,
          propertyName: data.propertyName
        });
        break;
      case 'step_update': {
        // プラットフォームが変わったらキューを更新（refで比較、ネスト回避）
        const prevPlatform = currentPlatformRef.current;
        if (prevPlatform !== data.platformId) {
          const newStep = pipelineStepsRef.current.find(
            s => s.id === data.platformId || s.platform === data.platformId
          );
          if (newStep?.properties) {
            setPropertyQueue([...newStep.properties]);
            setCompletedProperties([]);
          }
        }

        setCurrentPlatform(data.platformId);
        currentPlatformRef.current = data.platformId;
        setCurrentProperty(data.property);
        setCurrentActionMessage(data.message || getActionMessage(data.action));

        // パイプラインステップのstatusを更新（completedは変えない）
        setPipelineSteps(prev => {
          const updated = prev.map(step => {
            if (step.id === data.platformId || step.platform === data.platformId) {
              return { ...step, status: 'active' };
            }
            return step;
          });
          pipelineStepsRef.current = updated;
          return updated;
        });
        break;
      }
      case 'bukaku_progress':
        setBukakuProgress({ completed: data.completed, total: data.total, found: data.found });
        setStatusMessage(`Searching ${data.completed}/${data.total}`);
        if (data.remainingSeconds !== undefined) {
          setRemainingSeconds(data.remainingSeconds);
        }
        break;
      case 'property_result': {
        setBukakuResults(prev => [...prev, {
          property: data.property,
          success: data.found !== false,
          results: data.results || [],
          platform: data.platform
        }]);

        // バブルのステータスを更新 + completedインクリメント
        const propName = data.property?.property_name || '';
        const propRoom = data.property?.room_number || '';
        const bubbleStatus = data.found !== false ? 'found' : 'not_found';

        setPipelineSteps(prev => {
          const updated = prev.map(step => {
            if (step.id === data.platform || step.platform === data.platform) {
              const newCompleted = (step.completed || 0) + 1;
              // 該当物件のバブルstatusを更新
              const newProps = (step.properties || []).map(p => {
                if (p.status === 'searching' && p.property_name === propName && p.room_number === propRoom) {
                  return { ...p, status: bubbleStatus };
                }
                return p;
              });
              return {
                ...step,
                properties: newProps,
                completed: newCompleted,
                status: newCompleted >= step.count ? 'done' : step.status
              };
            }
            return step;
          });
          pipelineStepsRef.current = updated;
          return updated;
        });
        break;
      }
      case 'pipeline_complete':
        setIsLoading(false);
        setCurrentPhase('complete');
        setStatusMessage('');
        setRemainingSeconds(0);
        // 全ステップをdoneに
        setPipelineSteps(prev => prev.map(step => ({ ...step, status: 'done' })));
        wsRef.current?.close();
        break;
      case 'error':
        setError(data.message);
        setIsLoading(false);
        setCurrentPhase('idle');
        break;
    }
  };

  const reset = () => {
    setCurrentPhase('idle');
    setBukakuResults([]);
    setParsedProperties([]);
    setError(null);
    setSuccessMessage(null);
    setPipelineSteps([]);
    setCurrentPlatform(null);
    setCurrentProperty(null);
    setCurrentActionMessage('');
    setRemainingSeconds(null);
    setMatchingProgress(null);
    setPropertyQueue([]);
    setCompletedProperties([]);
  };

  const isInitialState = currentPhase === 'idle' && bukakuResults.length === 0;
  const foundCount = bukakuResults.filter(r => r.success).length;
  const progressPercent = currentPhase === 'parsing'
    ? (parsingProgress.total > 0 ? (parsingProgress.parsed / parsingProgress.total) * 100 : 0)
    : (bukakuProgress.total > 0 ? (bukakuProgress.completed / bukakuProgress.total) * 100 : 0);

  // 認証チェック中 or 未認証
  if (authChecking || !isAuthenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#09090b]">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-white/50 text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (isInitialState) {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-start pt-[15vh] px-4">
        <ParticleField />

        {/* Top Right Buttons */}
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
          {/* User Menu */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-lg glass hover:bg-white/10 transition-colors"
            title="Logout"
          >
            <span className="text-xs text-white/50">{currentUser?.name || currentUser?.email}</span>
            <svg className="w-4 h-4 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <svg className="w-5 h-5 text-white/50 hover:text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* Settings Modal */}
        {showSettings && (
          <SettingsModal
            onClose={() => setShowSettings(false)}
            poolStatus={poolStatus}
            onStatusUpdate={fetchPoolStatus}
          />
        )}

        <div className="relative z-10 w-full max-w-lg">
          {/* Logo */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-semibold tracking-tight mb-3">
              <span className="gradient-text">bukkaku</span>
              <span className="text-white/90 ml-2">AI</span>
            </h1>

            {/* Connection Status - Under Logo */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                poolStatus?.loggedIn > 0 ? "bg-emerald-400" : "bg-white/20"
              )} />
              <span className="text-xs text-white/40">
                {poolStatus?.loggedIn || 0} connections ready
              </span>
            </div>

            {/* Typing Effect */}
            <div className="h-6">
              <p className="text-sm font-mono text-white/30">
                {typingText}<span className="animate-pulse">|</span>
              </p>
            </div>
          </div>

          {/* Upload Area */}
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => handlePdfSelect(e.target.files)}
            ref={fileInputRef}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files.length > 0) handlePdfSelect(e.dataTransfer.files);
            }}
            className={cn(
              "upload-area group relative w-full rounded-2xl p-14 transition-all duration-300",
              isDragging && "dragging"
            )}
          >
            <div className="relative z-10 flex flex-col items-center">
              <div className={cn(
                "w-16 h-16 rounded-xl flex items-center justify-center mb-5 transition-all duration-300",
                isDragging ? "bg-violet-500/30 scale-110" : "bg-white/5 group-hover:bg-violet-500/20 group-hover:scale-105"
              )}>
                <svg
                  className={cn(
                    "w-8 h-8 transition-colors duration-300",
                    isDragging ? "text-violet-300" : "text-white/40 group-hover:text-violet-400"
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <span className={cn(
                "text-lg font-medium transition-colors duration-300",
                isDragging ? "text-violet-300" : successMessage ? "text-white/70" : "text-white/60 group-hover:text-white/90"
              )}>
                {successMessage ? typedSuccessMessage : "Start here."}
                {successMessage && <span className="animate-pulse">|</span>}
              </span>
            </div>
          </button>

          {/* Error */}
          {error && (
            <div className="mt-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 text-center">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Processing / Results View - 新しいミニマルUI
  return (
    <div className="relative min-h-dvh flex flex-col">
      <ParticleField />

      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <button onClick={reset} className="group flex items-center gap-2">
            <span className="text-base font-medium">
              <span className="gradient-text">bukkaku</span>
              <span className="text-white/80 ml-1">AI</span>
            </span>
          </button>
          {/* Notion Live Link - 常に表示 */}
          <a
            href="https://www.notion.so/2e21c1974dad81bfad4ace49ca030e9e"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <span className="text-sm text-white/50">↗</span>
            <span className="text-sm text-white/50">Notion</span>
            {isLoading && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-white/30">Live</span>
              </>
            )}
          </a>
        </div>
      </header>

      {/* Main Content - 中央寄せ */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* 処理中ビュー - Linear風パイプラインUI */}
        {isLoading && (
          <div className="flex flex-col items-center text-center w-full max-w-lg">
            {/* PDF解析中 */}
            {currentPhase === 'parsing' && (
              <div className="mb-10 w-full max-w-sm">
                <p className="text-sm text-white/50 mb-4">Analyzing PDF...</p>

                {/* 光る進捗バー */}
                <div className="relative h-1 bg-white/10 rounded-full overflow-hidden mb-4">
                  {/* ベースの進捗 */}
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: parsingProgress.total > 0 ? `${(parsingProgress.parsed / parsingProgress.total) * 100}%` : '0%' }}
                  />
                  {/* シャイニングエフェクト */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full overflow-hidden transition-all duration-300 ease-out"
                    style={{ width: parsingProgress.total > 0 ? `${(parsingProgress.parsed / parsingProgress.total) * 100}%` : '0%' }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
                  </div>
                </div>

                <p className="text-2xl font-mono text-white">
                  {parsingProgress.parsed}<span className="text-white/30"> / {parsingProgress.total || '?'}</span>
                </p>
              </div>
            )}

            {/* パイプラインステップ */}
            {currentPhase === 'searching' && pipelineSteps.length > 0 && (
              <div className="w-full max-w-md">
                <PipelineSteps
                  steps={pipelineSteps}
                  currentPlatform={currentPlatform}
                />
              </div>
            )}

            {/* 検索準備中（計画待ち） */}
            {currentPhase === 'searching' && pipelineSteps.length === 0 && (
              <div className="mb-10 text-center">
                <p className="text-2xl font-mono text-white mb-4">
                  {parsedProperties.length} properties
                </p>
                <p className="text-xs text-white/30 mb-4">
                  from {parsingProgress.total} pages
                </p>
                {matchingProgress ? (
                  <>
                    <p className="text-sm text-white/50 mb-2">
                      matching platforms... <span className="font-mono text-white/70">{matchingProgress.current}/{matchingProgress.total}</span>
                    </p>
                    <p className="text-xs text-white/30 animate-pulse truncate max-w-xs mx-auto">
                      {matchingProgress.propertyName}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-white/50 mb-3">
                    matching platforms...
                  </p>
                )}
              </div>
            )}

            {/* 残り時間（検索中のみ表示） */}
            {currentPhase === 'searching' && remainingSeconds !== null && remainingSeconds > 0 && (
              <p className="text-xs font-mono text-white/30 mt-6">
                ~{formatTime(remainingSeconds)}
              </p>
            )}
          </div>
        )}

        {/* 完了ビュー */}
        {currentPhase === 'complete' && (
          <div className="flex flex-col items-center text-center w-full max-w-lg">
            {/* 完了ステップインジケーター */}
            <div className="flex items-center gap-1 mb-8">
              {pipelineSteps.map((step, index) => (
                <div key={step.id} className="flex items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  {index < pipelineSteps.length - 1 && (
                    <div className="w-6 h-px mx-1 bg-emerald-400/50" />
                  )}
                </div>
              ))}
            </div>

            {/* 結果サマリー */}
            <p className="text-4xl font-semibold text-white tracking-tight mb-2">
              Complete
            </p>
            <p className="text-sm text-white/40 mb-10">
              {bukakuResults.length}件中 {foundCount}件の空きが見つかりました
            </p>

            {/* Notion誘導ボタン */}
            <a
              href="https://www.notion.so/2e21c1974dad81bfad4ace49ca030e9e"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-all"
            >
              Notionで詳細を確認 →
            </a>

            {/* リセットボタン */}
            <button
              onClick={reset}
              className="mt-6 text-sm text-white/40 hover:text-white/60 transition-colors"
            >
              新しい物確を開始
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
