import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Circle,
  ArrowRight,
  ArrowLeft,
  Sun,
  Moon,
  Shield,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';
import { BrandLogo } from './BrandLogo.tsx';

type AuthMode = 'signin' | 'signup' | 'reset';

interface PillarItem {
  id: string;
  index: string;
  navLabel: string;
  title: string;
  summary: string;
  detail: string;
}

const WORKSPACE_PILLARS: PillarItem[] = [
  {
    id: 'access',
    index: '01',
    navLabel: 'Access Control',
    title: 'Role-scoped workspace entry',
    summary: 'Every account is bound to explicit operational permissions across finance, operations, delivery, and client portals.',
    detail: 'Session tokens are verified server-side on every request before exposing ledgers, invoices, or receiving account records.',
  },
  {
    id: 'custody',
    index: '02',
    navLabel: 'Verification',
    title: 'Dual-stage settlement review',
    summary: 'Incoming transfers remain pending until confirmed through authorised finance review or bank statement matching.',
    detail: 'Duplicate reference guards and high-value dual approval prevent accidental double-crediting across obligations.',
  },
  {
    id: 'records',
    index: '03',
    navLabel: 'Audit Trail',
    title: 'Immutable financial traceability',
    summary: 'Every credential rotation, account update, and ledger credit writes a sanitized chronological audit record.',
    detail: 'Receipts and downloadable invoice PDFs are signed with short-lived expiring tokens generated strictly after verification.',
  },
  {
    id: 'security',
    index: '04',
    navLabel: 'Protection',
    title: 'Encrypted credential & account storage',
    summary: 'Sensitive receiving details are encrypted at rest with AES-256-GCM and masked in everyday operational views.',
    detail: 'Privileged workspace accounts support RFC 6238 authenticator MFA and fresh reauthentication checks.',
  },
];

function GoogleMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export function AuthPortal() {
  const {
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    authError,
    clearAuthError,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [activePillarId, setActivePillarId] = useState<string>(WORKSPACE_PILLARS[0].id);

  // Form states (always initialized empty)
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [localError, setLocalError] = useState<string | null>(null);
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const activePillar =
    WORKSPACE_PILLARS.find((p) => p.id === activePillarId) || WORKSPACE_PILLARS[0];

  // Password validation rules for Sign Up
  const hasMinLength = password.length >= 8;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumberOrSymbol = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setLocalError(null);
    setResetSentTo(null);
    clearAuthError();
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const handleGoogleAuth = async () => {
    setLocalError(null);
    setResetSentTo(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setResetSentTo(null);
    clearAuthError();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setLocalError('Enter a valid email address to continue.');
      return;
    }

    if (mode === 'reset') {
      setSubmitting(true);
      try {
        const ok = await sendPasswordReset(trimmedEmail);
        if (ok) {
          setResetSentTo(trimmedEmail);
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode === 'signup') {
      if (fullName.trim().length < 2) {
        setLocalError('Enter your full name (at least 2 characters).');
        return;
      }
      if (!hasMinLength || !hasMixedCase || !hasNumberOrSymbol) {
        setLocalError(
          'Password must be at least 8 characters and include uppercase, lowercase, and a number or symbol.'
        );
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match. Re-enter your confirmation password.');
        return;
      }

      setSubmitting(true);
      try {
        await signUpWithEmail(fullName.trim(), trimmedEmail, password);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!password) {
      setLocalError('Enter your password to sign in.');
      return;
    }

    setSubmitting(true);
    try {
      await signInWithEmail(trimmedEmail, password);
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* 3-Zone Top Navigation Bar */}
      <header className="h-20 px-6 lg:px-12 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-8 shrink-0">
        <BrandLogo size="md" />

        <nav
          className="hidden md:flex items-center gap-6 text-sm font-medium"
          aria-label="Platform architecture highlights"
        >
          {WORKSPACE_PILLARS.map((pillar) => {
            const isSelected = pillar.id === activePillarId;
            return (
              <button
                key={pillar.id}
                type="button"
                onClick={() => setActivePillarId(pillar.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  isSelected
                    ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {pillar.navLabel}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
      </header>

      {/* Main Split Authentication Surface */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-12 py-8 lg:py-12">
        <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Left Panel: Architectural Brand & Capability Context */}
          <section
            aria-label="Workspace security overview"
            className="lg:col-span-6 relative overflow-hidden rounded-xl bg-slate-900 text-slate-100 border border-slate-800 p-8 sm:p-10 flex flex-col justify-between gap-8"
          >
            {/* Subtle architectural grid lines */}
            <svg
              className="pointer-events-none absolute top-0 right-0 w-72 h-72 text-slate-800/70"
              viewBox="0 0 240 240"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M40 0V240M100 0V240M160 0V240M220 0V240M0 40H240M0 100H240M0 160H240M0 220H240"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>

            <div className="relative space-y-5">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Shield className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                <span>Treasury & Operations Portal</span>
              </div>

              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight">
                Structured access for billing, settlement review, and ledger control.
              </h1>

              <p className="text-sm text-slate-300 leading-relaxed max-w-lg">
                Sign in with an existing workspace account or register a new profile to access assigned project schedules, verification workflows, and verified payment records.
              </p>
            </div>

            {/* Active Pillar Spotlight + Interactive Selector */}
            <div className="relative space-y-5 pt-6 border-t border-slate-800">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 text-xs text-slate-400 font-mono tabular-nums">
                  <span>{activePillar.index}.</span>
                  <span className="font-sans font-medium text-slate-200">
                    {activePillar.title}
                  </span>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed">{activePillar.summary}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{activePillar.detail}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                {WORKSPACE_PILLARS.map((pillar) => {
                  const active = pillar.id === activePillarId;
                  return (
                    <button
                      key={pillar.id}
                      type="button"
                      onClick={() => setActivePillarId(pillar.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                        active
                          ? 'bg-slate-800 border-slate-600 text-white'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-[11px] font-mono tabular-nums text-slate-400">
                        {pillar.index}
                      </div>
                      <div className="text-xs font-medium truncate mt-0.5">{pillar.navLabel}</div>
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-slate-500 pt-2 border-t border-slate-800/80">
                New accounts default to scoped client access until assigned an administrative or finance role by an organisation administrator.
              </p>
            </div>
          </section>

          {/* Right Panel: Interactive Sign In / Sign Up / Reset Card */}
          <section
            aria-label="Account authentication"
            className="lg:col-span-6 flex items-center"
          >
            <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-9 space-y-6">
              {/* Segmented Switcher (hidden on Reset Password screen) */}
              {mode !== 'reset' ? (
                <div
                  className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                  role="tablist"
                  aria-label="Authentication mode"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signin'}
                    onClick={() => switchMode('signin')}
                    className={`py-2 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      mode === 'signin'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signup'}
                    onClick={() => switchMode('signup')}
                    className={`py-2 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      mode === 'signup'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Create Account
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to sign in</span>
                </button>
              )}

              {/* Heading */}
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {mode === 'signin'
                    ? 'Sign in to your account'
                    : mode === 'signup'
                      ? 'Create a workspace account'
                      : 'Reset your password'}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {mode === 'signin'
                    ? 'Enter your credentials or continue with Google to open your workspace.'
                    : mode === 'signup'
                      ? 'Register your name and email address to set up access.'
                      : 'Enter the email address associated with your account to receive a reset link.'}
                </p>
              </div>

              {/* Error or Status Alert */}
              {displayError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 border border-red-200 dark:border-red-900/80 bg-red-50/80 dark:bg-red-950/30 rounded-lg p-3.5 text-xs text-red-700 dark:text-red-300"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{displayError}</span>
                </div>
              )}

              {resetSentTo && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 border border-emerald-200 dark:border-emerald-900/80 bg-emerald-50/80 dark:bg-emerald-950/30 rounded-lg p-3.5 text-xs text-emerald-800 dark:text-emerald-300"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    If an account exists for <span className="font-semibold">{resetSentTo}</span>, a password reset link has been sent to that inbox.
                  </span>
                </div>
              )}

              {/* Google Single Sign-On */}
              {mode !== 'reset' && (
                <>
                  <button
                    type="button"
                    disabled={googleLoading || submitting}
                    onClick={handleGoogleAuth}
                    className="w-full min-h-[42px] py-2.5 px-4 inline-flex items-center justify-center gap-2.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <GoogleMark />
                    <span>
                      {googleLoading
                        ? 'Connecting to Google...'
                        : mode === 'signup'
                          ? 'Sign up with Google'
                          : 'Continue with Google'}
                    </span>
                  </button>

                  <div className="relative flex items-center">
                    <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                    <span className="px-3 text-xs text-slate-400 dark:text-slate-500">
                      or continue with email
                    </span>
                    <div className="flex-1 border-t border-slate-200 dark:border-slate-800" />
                  </div>
                </>
              )}

              {/* Email / Password Form */}
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {mode === 'signup' && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="auth-full-name"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Full Name
                    </label>
                    <input
                      id="auth-full-name"
                      type="text"
                      required
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Morgan"
                      className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Email Address
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
                  />
                </div>

                {mode !== 'reset' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="auth-password"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        Password
                      </label>
                      {mode === 'signin' && (
                        <button
                          type="button"
                          onClick={() => switchMode('reset')}
                          className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-2"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        id="auth-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === 'signup' ? 'Create a strong password' : 'Enter your password'}
                        className="w-full min-h-[42px] pl-3.5 pr-11 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'signup' && (
                  <>
                    {/* Password Strength Requirements */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5 text-[11px]">
                      {[
                        { ok: hasMinLength, label: '8+ characters' },
                        { ok: hasMixedCase, label: 'Upper & lowercase' },
                        { ok: hasNumberOrSymbol, label: 'Number or symbol' },
                      ].map((rule) => (
                        <div
                          key={rule.label}
                          className={`flex items-center gap-1.5 ${
                            rule.ok
                              ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {rule.ok ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>{rule.label}</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="auth-confirm-password"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        Confirm Password
                      </label>
                      <div className="relative">
                        <input
                          id="auth-confirm-password"
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter your password"
                          className="w-full min-h-[42px] pl-3.5 pr-11 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((v) => !v)}
                          aria-label={
                            showConfirmPassword
                              ? 'Hide confirmation password'
                              : 'Show confirmation password'
                          }
                          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      {confirmPassword.length > 0 && !passwordsMatch && (
                        <p className="text-[11px] text-red-600 dark:text-red-400">
                          Confirmation does not match password.
                        </p>
                      )}
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={submitting || googleLoading}
                  className="w-full min-h-[44px] py-2.5 px-5 inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100 transition-opacity disabled:opacity-50 whitespace-nowrap"
                >
                  <span>
                    {submitting
                      ? mode === 'signin'
                        ? 'Signing in...'
                        : mode === 'signup'
                          ? 'Creating account...'
                          : 'Sending reset link...'
                      : mode === 'signin'
                        ? 'Sign In'
                        : mode === 'signup'
                          ? 'Create Account'
                          : 'Send Reset Link'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Footer Mode Cross-Link */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                {mode === 'signin' ? (
                  <>
                    <span>Need workspace credentials?</span>
                    <button
                      type="button"
                      onClick={() => switchMode('signup')}
                      className="font-semibold text-slate-900 dark:text-slate-100 hover:underline underline-offset-2"
                    >
                      Create an account
                    </button>
                  </>
                ) : mode === 'signup' ? (
                  <>
                    <span>Already registered?</span>
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="font-semibold text-slate-900 dark:text-slate-100 hover:underline underline-offset-2"
                    >
                      Sign in instead
                    </button>
                  </>
                ) : (
                  <>
                    <span>Remembered your password?</span>
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="font-semibold text-slate-900 dark:text-slate-100 hover:underline underline-offset-2"
                    >
                      Return to sign in
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
