import React, { useState, useEffect } from 'react';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  MailCheck,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';
import { BrandLogo } from './BrandLogo.tsx';

type AuthPanel = 'signin' | 'signup' | 'forgot';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginGate() {
  const { signInWithGoogle, enterSandboxSession, authError } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [panel, setPanel] = useState<AuthPanel>('signin');
  const [signingInGoogle, setSigningInGoogle] = useState(false);

  // Sign In state
  const [siEmail, setSiEmail] = useState('');
  const [siPassword, setSiPassword] = useState('');
  const [siShowPw, setSiShowPw] = useState(false);
  const [siCapsLock, setSiCapsLock] = useState(false);
  const [siRemember, setSiRemember] = useState(true);
  const [siLoading, setSiLoading] = useState(false);
  const [siErrors, setSiErrors] = useState<{ email?: string; password?: string }>({});

  // Sign Up (2-Step) state
  const [suStep, setSuStep] = useState<1 | 2>(1);
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suShowPw, setSuShowPw] = useState(false);
  const [suBusiness, setSuBusiness] = useState('');
  const [suCurrency, setSuCurrency] = useState('INR');
  const [suVolume, setSuVolume] = useState('$10k-$100k');
  const [suTerms, setSuTerms] = useState(false);
  const [suLoading, setSuLoading] = useState(false);
  const [suErrors, setSuErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    business?: string;
    terms?: string;
  }>({});

  // Forgot Password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const t = window.setInterval(() => {
      setResendSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [resendSeconds]);

  const siEmailValid = EMAIL_RE.test(siEmail.trim());
  const suEmailValid = EMAIL_RE.test(suEmail.trim());

  const passwordScore = (() => {
    let score = 0;
    if (suPassword.length >= 8) score++;
    if (/[A-Z]/.test(suPassword)) score++;
    if (/[0-9]/.test(suPassword)) score++;
    if (/[^A-Za-z0-9]/.test(suPassword)) score++;
    return score;
  })();

  const strengthBars = ['bg-rose-500', 'bg-amber-500', 'bg-[#0d6efd]', 'bg-[#00b8ff]'];
  const strengthLabels = ['Weak', 'Fair', 'Strong', 'Forged'];
  const strengthTextColors = ['text-rose-500', 'text-amber-500', 'text-[#0d6efd]', 'text-[#00b8ff]'];

  const handleGoogleClick = async () => {
    setSigningInGoogle(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningInGoogle(false);
    }
  };

  const switchTab = (next: AuthPanel) => {
    setPanel(next);
    setSiErrors({});
    setSuErrors({});
    setForgotError(null);
    if (next === 'forgot') {
      setForgotSent(false);
    }
  };

  const handleSignInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { email?: string; password?: string } = {};
    const email = siEmail.trim();
    if (!EMAIL_RE.test(email)) errs.email = 'Please enter a valid work email.';
    if (siPassword.length < 6) errs.password = 'Password must be at least 6 characters.';
    setSiErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const derivedName = email
      .split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const domainPart = (email.split('@')[1] || '').split('.')[0] || '';
    const derivedBusiness = domainPart
      ? domainPart.charAt(0).toUpperCase() + domainPart.slice(1)
      : 'ForgeX Merchant';
    const descriptorSlug =
      derivedBusiness.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || 'MERCHANT';

    setSiLoading(true);
    setTimeout(() => {
      setSiLoading(false);
      enterSandboxSession({
        name: derivedName || 'Merchant',
        business: derivedBusiness,
        email,
        currency: 'INR',
        descriptor: `FORGEXPAY*${descriptorSlug}`,
        isSandbox: true,
      });
    }, 350);
  };

  const handleNextSignupStep = () => {
    const errs: typeof suErrors = {};
    if (!suName.trim()) errs.name = 'Full name is required.';
    if (!EMAIL_RE.test(suEmail.trim())) errs.email = 'Enter a valid work email.';
    if (suPassword.length < 8) errs.password = 'Password must be at least 8 characters.';
    setSuErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSuStep(2);
  };

  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof suErrors = {};
    const biz = suBusiness.trim();
    if (!biz) errs.business = 'Business name is required.';
    if (!suTerms) errs.terms = 'Please agree to the Merchant Services Agreement.';
    setSuErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const descriptor = `FORGEXPAY*${biz.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || 'MERCH'}`;
    setSuLoading(true);
    setTimeout(() => {
      setSuLoading(false);
      enterSandboxSession({
        name: suName.trim(),
        email: suEmail.trim(),
        business: biz,
        currency: suCurrency,
        descriptor,
        isSandbox: true,
      });
    }, 400);
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const email = forgotEmail.trim();
    if (!EMAIL_RE.test(email)) {
      setForgotError('Enter a valid work email.');
      return;
    }
    setForgotError(null);
    setForgotSent(true);
    setResendSeconds(30);
  };

  return (
    <main className="auth-backdrop min-h-screen w-full flex flex-col items-center justify-center px-4 py-10 relative text-[#072146] dark:text-slate-100 transition-colors duration-200">
      {/* Top-Right Light/Dark Mode Toggle */}
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-20">
        <button
          type="button"
          onClick={toggleTheme}
          title="Toggle Light / Dark theme"
          aria-label="Toggle Light / Dark theme"
          className="p-2.5 rounded-xl bg-white dark:bg-[#071630] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Centered Auth Container */}
      <div className="w-full max-w-[440px]">
        {/* Centered forgeXPay Brand Lockup */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="mb-2">
            <BrandLogo size="lg" />
          </div>
          <p className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            4XPay by ForgeX · Payments, Managed Smarter
          </p>
        </div>

        {/* Clean Elevated Auth Card */}
        <div className="rounded-2xl bg-white dark:bg-[#071630] border border-slate-200/90 dark:border-slate-800 shadow-sm p-6 sm:p-8">
          {/* Segmented Tab Switch: Sign In / Create Account */}
          {panel !== 'forgot' && (
            <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 dark:bg-[#0b1d3d] border border-slate-200/70 dark:border-slate-800 mb-6">
              <button
                type="button"
                onClick={() => switchTab('signin')}
                className={`py-2 text-sm font-semibold rounded-lg transition-colors ${
                  panel === 'signin'
                    ? 'bg-white dark:bg-[#0f264f] text-[#072146] dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchTab('signup')}
                className={`py-2 text-sm font-semibold rounded-lg transition-colors ${
                  panel === 'signup'
                    ? 'bg-white dark:bg-[#0f264f] text-[#072146] dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          {authError && (
            <div className="mb-4 border border-rose-200 dark:border-rose-800/80 bg-rose-50/80 dark:bg-rose-950/30 rounded-xl p-3 text-xs text-rose-700 dark:text-rose-300">
              {authError}
            </div>
          )}

          {/* TAB A: SIGN IN */}
          {panel === 'signin' && (
            <div className="space-y-4">
              <button
                type="button"
                disabled={signingInGoogle}
                onClick={handleGoogleClick}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] hover:bg-slate-50 dark:hover:bg-[#0f2448] text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                  />
                </svg>
                <span>{signingInGoogle ? 'Signing in with Google...' : 'Continue with Google'}</span>
              </button>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="mx-3 text-xs text-slate-400">or continue with email</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="signin-email"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Work Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="signin-email"
                      type="email"
                      autoComplete="email"
                      value={siEmail}
                      onChange={(e) => setSiEmail(e.target.value)}
                      className="forge-input w-full pl-10 pr-9 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none transition-colors"
                    />
                    {siEmailValid && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500">
                        <CheckCircle2 className="w-4 h-4" />
                      </span>
                    )}
                  </div>
                  {siErrors.email && (
                    <p className="mt-1 text-xs text-rose-500">{siErrors.email}</p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="signin-password"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => switchTab('forgot')}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="signin-password"
                      type={siShowPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={siPassword}
                      onChange={(e) => setSiPassword(e.target.value)}
                      onKeyUp={(e) =>
                        setSiCapsLock(Boolean(e.getModifierState && e.getModifierState('CapsLock')))
                      }
                      className="forge-input w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setSiShowPw((v) => !v)}
                      aria-label={siShowPw ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {siShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {siCapsLock && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
                      <AlertTriangle className="w-3 h-3" /> Caps Lock is ON
                    </div>
                  )}
                  {siErrors.password && (
                    <p className="mt-1 text-xs text-rose-500">{siErrors.password}</p>
                  )}
                </div>

                <div className="flex items-center pt-0.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={siRemember}
                      onChange={(e) => setSiRemember(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-[#0d6efd] focus:ring-[#0d6efd]"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-400">Remember me</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={siLoading}
                  className="w-full h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <span>{siLoading ? 'Please wait...' : 'Sign In'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

          {/* TAB B: 2-STEP CREATE ACCOUNT */}
          {panel === 'signup' && (
            <div className="space-y-4">
              <button
                type="button"
                disabled={signingInGoogle}
                onClick={handleGoogleClick}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] hover:bg-slate-50 dark:hover:bg-[#0f2448] text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                  />
                </svg>
                <span>{signingInGoogle ? 'Signing in with Google...' : 'Continue with Google'}</span>
              </button>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="mx-3 text-xs text-slate-400">or continue with email</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              {/* 2-Step Progress Indicator */}
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a1b38] border border-slate-200/70 dark:border-slate-800">
                <div className="flex items-center gap-2 flex-1">
                  <span
                    className={`w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center ${
                      suStep === 2 ? 'bg-emerald-500' : 'bg-[#0d6efd]'
                    }`}
                  >
                    {suStep === 2 ? '✓' : '1'}
                  </span>
                  <span className="text-xs font-semibold text-[#072146] dark:text-white">
                    Account
                  </span>
                </div>
                <div className="w-10 h-0.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-[#00b8ff] transition-all duration-200 ${
                      suStep === 2 ? 'w-full' : 'w-0'
                    }`}
                  />
                </div>
                <div className="flex items-center gap-2 flex-1 justify-end">
                  <span
                    className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                      suStep === 2
                        ? 'bg-[#0d6efd] text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                    }`}
                  >
                    2
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      suStep === 2 ? 'text-[#072146] dark:text-white' : 'text-slate-400'
                    }`}
                  >
                    Business
                  </span>
                </div>
              </div>

              <form onSubmit={handleSignUpSubmit} noValidate>
                {suStep === 1 ? (
                  <div className="space-y-3.5">
                    <div>
                      <label
                        htmlFor="su-name"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Full Name
                      </label>
                      <input
                        id="su-name"
                        type="text"
                        value={suName}
                        onChange={(e) => setSuName(e.target.value)}
                        className="forge-input w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none"
                      />
                      {suErrors.name && (
                        <p className="mt-1 text-xs text-rose-500">{suErrors.name}</p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="su-email"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Work Email
                      </label>
                      <div className="relative">
                        <input
                          id="su-email"
                          type="email"
                          value={suEmail}
                          onChange={(e) => setSuEmail(e.target.value)}
                          className="forge-input w-full pl-3.5 pr-9 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none"
                        />
                        {suEmailValid && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500">
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                      {suErrors.email && (
                        <p className="mt-1 text-xs text-rose-500">{suErrors.email}</p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="su-password"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="su-password"
                          type={suShowPw ? 'text' : 'password'}
                          value={suPassword}
                          onChange={(e) => setSuPassword(e.target.value)}
                          className="forge-input w-full pl-3.5 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setSuShowPw((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          {suShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="mt-2">
                        <div className="grid grid-cols-4 gap-1.5 h-1.5">
                          {[1, 2, 3, 4].map((bar) => (
                            <div
                              key={bar}
                              className={`rounded-full transition-colors ${
                                bar <= passwordScore
                                  ? strengthBars[passwordScore - 1]
                                  : 'bg-slate-200 dark:bg-slate-800'
                              }`}
                            />
                          ))}
                        </div>
                        <div className="mt-1">
                          {!suPassword ? (
                            <span className="text-[11px] font-medium text-slate-400">
                              Min 8 chars, uppercase, number &amp; symbol
                            </span>
                          ) : (
                            <span
                              className={`text-[11px] font-semibold ${
                                strengthTextColors[Math.max(0, passwordScore - 1)]
                              }`}
                            >
                              Password strength:{' '}
                              {strengthLabels[Math.max(0, passwordScore - 1)]}
                            </span>
                          )}
                        </div>
                      </div>
                      {suErrors.password && (
                        <p className="mt-1 text-xs text-rose-500">{suErrors.password}</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleNextSignupStep}
                      className="w-full h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <span>Continue</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    <div>
                      <label
                        htmlFor="su-business"
                        className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Business Name
                      </label>
                      <input
                        id="su-business"
                        type="text"
                        value={suBusiness}
                        onChange={(e) => setSuBusiness(e.target.value)}
                        className="forge-input w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none"
                      />
                      {suErrors.business && (
                        <p className="mt-1 text-xs text-rose-500">{suErrors.business}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="su-currency"
                          className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Settlement Currency
                        </label>
                        <select
                          id="su-currency"
                          value={suCurrency}
                          onChange={(e) => setSuCurrency(e.target.value)}
                          className="forge-input w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none"
                        >
                          <option value="USD">USD ($)</option>
                          <option value="INR">INR (₹)</option>
                          <option value="EUR">EUR (€)</option>
                          <option value="GBP">GBP (£)</option>
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="su-volume"
                          className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Monthly Volume
                        </label>
                        <select
                          id="su-volume"
                          value={suVolume}
                          onChange={(e) => setSuVolume(e.target.value)}
                          className="forge-input w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none"
                        >
                          <option value="<$10k">&lt; $10k / mo</option>
                          <option value="$10k-$100k">$10k – $100k</option>
                          <option value="$100k-$1M">$100k – $1M</option>
                          <option value="$1M+">$1M+ / mo</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="inline-flex items-start gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={suTerms}
                          onChange={(e) => setSuTerms(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-[#0d6efd] focus:ring-[#0d6efd]"
                        />
                        <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          I agree to the forgeXPay{' '}
                          <span className="text-[#0d6efd] dark:text-[#25d0ff] font-medium">
                            Merchant Services Agreement
                          </span>{' '}
                          and{' '}
                          <span className="text-[#0d6efd] dark:text-[#25d0ff] font-medium">
                            Privacy Policy
                          </span>
                          .
                        </span>
                      </label>
                      {suErrors.terms && (
                        <p className="mt-1 text-xs text-rose-500">{suErrors.terms}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setSuStep(1)}
                        className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        disabled={suLoading}
                        className="flex-1 h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <span>{suLoading ? 'Creating...' : 'Create Account'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </div>
          )}

          {/* TAB C: FORGOT PASSWORD */}
          {panel === 'forgot' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => switchTab('signin')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#0d6efd] dark:hover:text-[#25d0ff]"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
              </button>

              {!forgotSent ? (
                <form onSubmit={handleForgotSubmit} className="space-y-4" noValidate>
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#072146] dark:text-white">
                      Reset your password
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Enter your work email and we will send a secure recovery link.
                    </p>
                  </div>
                  <div>
                    <label
                      htmlFor="forgot-email"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Work Email
                    </label>
                    <input
                      id="forgot-email"
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="forge-input w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0a1b38] text-slate-900 dark:text-white focus:outline-none"
                    />
                    {forgotError && (
                      <p className="mt-1 text-xs text-rose-500">{forgotError}</p>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="w-full h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors"
                  >
                    Send Reset Link
                  </button>
                </form>
              ) : (
                <div className="p-4 rounded-xl bg-sky-50/80 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 text-center space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-[#0d6efd]/15 text-[#0d6efd] dark:text-[#25d0ff] mx-auto flex items-center justify-center">
                    <MailCheck className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-bold text-[#072146] dark:text-white">
                    Check your inbox
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Reset link sent to{' '}
                    <span className="font-mono font-semibold">{forgotEmail.trim()}</span>
                  </p>
                  <button
                    type="button"
                    disabled={resendSeconds > 0}
                    onClick={() => setResendSeconds(30)}
                    className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#071630] text-xs font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-60"
                  >
                    {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend Reset Link'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Minimal Trust Footer */}
        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">
          PCI-DSS Level 1 • 256-bit Encryption • 99.99% Uptime
        </p>
      </div>
    </main>
  );
}
