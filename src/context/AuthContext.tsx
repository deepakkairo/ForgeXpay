import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiRequest } from '../lib/api.ts';

export type RoleCode = 'SUPER_ADMIN' | 'FINANCE_ADMIN' | 'ADMIN_HQ' | 'EMPLOYEE' | 'CLIENT';

export interface ProfileUser {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  roles: RoleCode[];
  mfaEnabled: boolean;
  lastReauthAt: string | null;
}

export interface ActiveReceivingSummary {
  id: string;
  accountCode: string;
  upiId: string;
  displayPayeeName: string;
  manualCheckAttested: boolean;
}

export interface MerchantMeta {
  name: string;
  business: string;
  email: string;
  currency?: string;
  descriptor?: string;
  isSandbox?: boolean;
}

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  profile: ProfileUser | null;
  isSandboxSession: boolean;
  merchantMeta: MerchantMeta | null;
  unreadNotifications: number;
  activeReceivingConfigured: boolean;
  activeReceivingSummary: ActiveReceivingSummary | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<boolean>;
  signUpWithEmail: (displayName: string, email: string, password: string) => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  enterSandboxSession: (meta: MerchantMeta) => void;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasAnyRole: (...roles: RoleCode[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function formatFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'The email address or password you entered is incorrect.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts. Please wait a few minutes and try again.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in window was closed before completing authentication.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled in this Firebase project. Try Google sign-in or enable Email/Password in Firebase Console.';
    case 'auth/network-request-failed':
      return 'Network connection failed while contacting the authentication service.';
    default:
      return err instanceof Error ? err.message : 'Authentication could not be completed.';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [isSandboxSession, setIsSandboxSession] = useState(false);
  const [merchantMeta, setMerchantMeta] = useState<MerchantMeta | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [activeReceivingConfigured, setActiveReceivingConfigured] = useState(false);
  const [activeReceivingSummary, setActiveReceivingSummary] =
    useState<ActiveReceivingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const loadBackendProfile = useCallback(async () => {
    try {
      const data = await apiRequest<{
        user: ProfileUser;
        unreadNotifications: number;
        activeReceivingConfigured: boolean;
        activeReceivingSummary?: ActiveReceivingSummary | null;
      }>('/me');
      setProfile(data.user);
      setIsSandboxSession(false);
      setUnreadNotifications(data.unreadNotifications);
      setActiveReceivingConfigured(data.activeReceivingConfigured);
      setActiveReceivingSummary(data.activeReceivingSummary ?? null);
      setAuthError(null);
    } catch (err) {
      console.error('Failed to sync profile:', err);
      setAuthError(err instanceof Error ? err.message : 'Unable to load session profile.');
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        await loadBackendProfile();
      } else {
        setProfile(null);
        setIsSandboxSession(false);
        setMerchantMeta(null);
        setUnreadNotifications(0);
        setActiveReceivingSummary(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [loadBackendProfile]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      setAuthError(formatFirebaseAuthError(err));
    }
  };

  const signInWithEmail = async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      return true;
    } catch (err: unknown) {
      setAuthError(formatFirebaseAuthError(err));
      return false;
    }
  };

  const signUpWithEmail = async (
    displayName: string,
    email: string,
    password: string
  ): Promise<boolean> => {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const trimmedName = displayName.trim();
      if (trimmedName) {
        await updateProfile(cred.user, { displayName: trimmedName });
        await cred.user.reload();
      }
      await loadBackendProfile();
      return true;
    } catch (err: unknown) {
      setAuthError(formatFirebaseAuthError(err));
      return false;
    }
  };

  const sendPasswordReset = async (email: string): Promise<boolean> => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      return true;
    } catch (err: unknown) {
      setAuthError(formatFirebaseAuthError(err));
      return false;
    }
  };

  const enterSandboxSession = useCallback((meta: MerchantMeta) => {
    setMerchantMeta(meta);
    setIsSandboxSession(true);
    setProfile({
      id: 'sandbox-merchant',
      uid: 'sandbox-merchant',
      email: meta.email,
      displayName: meta.name,
      photoUrl: null,
      roles: ['CLIENT'],
      mfaEnabled: false,
      lastReauthAt: null,
    });
    setAuthError(null);
  }, []);

  const logout = async () => {
    if (firebaseUser) {
      await signOut(auth);
    }
    setProfile(null);
    setIsSandboxSession(false);
    setMerchantMeta(null);
    setActiveReceivingSummary(null);
  };

  const hasAnyRole = useCallback(
    (...allowed: RoleCode[]) => {
      if (!profile) return false;
      return profile.roles.some((r) => allowed.includes(r));
    },
    [profile]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        isSandboxSession,
        merchantMeta,
        unreadNotifications,
        activeReceivingConfigured,
        activeReceivingSummary,
        loading,
        authError,
        clearAuthError,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        sendPasswordReset,
        enterSandboxSession,
        logout,
        refreshProfile: loadBackendProfile,
        hasAnyRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
