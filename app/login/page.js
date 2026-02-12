'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (data.success) {
        localStorage.setItem('bukkaku_token', data.token);
        localStorage.setItem('bukkaku_user', JSON.stringify(data.user));
        router.push('/');
      } else {
        setError(data.error || 'ログインに失敗しました');
      }
    } catch (err) {
      setError('サーバーに接続できません');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">
            <span className="gradient-text">bukkaku</span>
            <span className="text-white/90 ml-2">AI</span>
          </h1>
          <p className="text-sm text-white/40">Sign in to continue</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-white/50 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:bg-white/8 transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-white/50 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:bg-white/8 transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400 text-center">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-medium hover:from-violet-500 hover:to-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-white/30">
          Contact admin for account access
        </p>
      </div>
    </div>
  );
}
