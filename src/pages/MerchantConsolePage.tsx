import React, { useRef, useEffect, useCallback, useState } from 'react';
import { RefreshCw, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useTheme } from '../context/ThemeContext.tsx';

const CONSOLE_ASSET_PATH = '/assets/aistudio/forgexpay_payment_gateway_merchant_console_345559be.html';

interface ConsoleWindow extends Window {
  completeAuthEntry?: (
    profile: {
      name: string;
      business: string;
      email: string;
      currency?: string;
      descriptor?: string;
    },
    toastMsg: string
  ) => void;
  renderCharts?: () => void;
}

export function MerchantConsolePage() {
  const { profile, merchantMeta, isSandboxSession, signInWithGoogle } = useAuth();
  const { theme } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  const syncThemeToIframe = useCallback(() => {
    const win = iframeRef.current?.contentWindow as ConsoleWindow | null;
    if (!win?.document?.documentElement) return;
    if (theme === 'dark') {
      win.document.documentElement.classList.add('dark');
    } else {
      win.document.documentElement.classList.remove('dark');
    }
    try {
      win.renderCharts?.();
    } catch {
      // charts only render when overview tab is active
    }
  }, [theme]);

  const handleIframeLoad = useCallback(() => {
    const win = iframeRef.current?.contentWindow as ConsoleWindow | null;
    if (!win) return;

    syncThemeToIframe();

    const merchantProfile = {
      name: merchantMeta?.name || profile?.displayName || 'Merchant',
      business: merchantMeta?.business || 'ForgeX Merchant',
      email: merchantMeta?.email || profile?.email || '',
      currency: merchantMeta?.currency || 'INR',
      descriptor: merchantMeta?.descriptor || 'FORGEXPAY*MERCHANT',
    };

    window.setTimeout(() => {
      try {
        if (typeof win.completeAuthEntry === 'function') {
          win.completeAuthEntry(
            merchantProfile,
            isSandboxSession
              ? 'Merchant Sandbox Console active'
              : `Signed in as ${merchantProfile.email}`
          );
        }
      } catch {
        // ignore cross-timing error
      }
    }, 80);
  }, [merchantMeta, profile, isSandboxSession, syncThemeToIframe]);

  useEffect(() => {
    syncThemeToIframe();
  }, [syncThemeToIframe]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#072146] dark:text-white">
            forgeXPay Merchant Gateway Console
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Interactive merchant dashboard with analytics, transactions, payouts, payment links, and webhook tester.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSandboxSession && (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0d6efd] hover:bg-[#0b5ed7] text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Connect Google for Live 4XPay Backend</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setFrameKey((k) => k + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#071630] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Console</span>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#071630] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{expanded ? 'Standard View' : 'Full Viewport'}</span>
          </button>
        </div>
      </div>

      <div
        className={`rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#040e21] shadow-xs ${
          expanded ? 'fixed inset-3 z-50 shadow-2xl' : 'h-[calc(100vh-11.5rem)] min-h-[680px]'
        }`}
      >
        {expanded && (
          <div className="h-10 px-4 bg-[#072146] text-white flex items-center justify-between text-xs">
            <span className="font-semibold">forgeXPay Merchant Gateway Console</span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 font-medium"
            >
              Exit Fullscreen
            </button>
          </div>
        )}
        <iframe
          key={frameKey}
          ref={iframeRef}
          src={CONSOLE_ASSET_PATH}
          title="forgeXPay Merchant Gateway Console"
          onLoad={handleIframeLoad}
          className={`w-full border-0 ${expanded ? 'h-[calc(100%-2.5rem)]' : 'h-full'}`}
        />
      </div>
    </div>
  );
}
