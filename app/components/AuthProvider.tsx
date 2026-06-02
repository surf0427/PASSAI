'use client';

// STEP-AUTH-01 / STEP-AUTH-02 / AUTH DEBUG FIX 01:
//   Anonymous auth + profile context provider with debug-friendly state.
//
// Exposed state（context value）:
//   - currentUserId / profile  既存 API
//   - authReady     anonymous auth が確定（成功 or 失敗）した時点で true
//   - profileReady  profile ensure が確定（成功 or 失敗）した時点で true
//   - authError     anonymous auth が失敗していれば message。成功 / pending は null
//   - profileError  profile ensure が失敗していれば message。成功 / pending は null
//   - setProfile    UI が保存後にコンテキストを同期するための差し替え
//   - retryProfile  /account 側から手動で再試行するための非同期 helper
//
// 既存機能は currentUserId / profile / setProfile のみを使うため、追加 state は
// 後方互換。auth 失敗 / profile 失敗 / 単に処理中 を呼び出し側が切り分けられる。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ensureAnonymousUser } from '@/lib/supabase/auth';
import { ensureProfile } from '@/lib/supabase/profile';
import type { Profile } from '@/types/profile';

type AuthContextValue = {
  currentUserId: string | null;
  profile: Profile | null;
  authReady: boolean;
  profileReady: boolean;
  authError: string | null;
  profileError: string | null;
  setProfile: (profile: Profile) => void;
  retryProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  currentUserId: null,
  profile: null,
  authReady: false,
  profileReady: false,
  authError: null,
  profileError: null,
  setProfile: () => {},
  retryProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // retryProfile が常に最新の userId を参照できるよう ref に保持。
  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = currentUserId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authResult = await ensureAnonymousUser();
      if (cancelled) return;
      if (authResult.kind === 'ok') {
        setCurrentUserId(authResult.userId);
        setAuthError(null);
      } else if (authResult.kind === 'no-env') {
        setAuthError(
          'Supabase 接続情報が読み込まれていません (NEXT_PUBLIC_SUPABASE_* 未設定)。',
        );
      } else {
        setAuthError(authResult.message);
      }
      setAuthReady(true);

      if (authResult.kind !== 'ok') {
        setProfileReady(true);
        return;
      }

      const profileResult = await ensureProfile(authResult.userId);
      if (cancelled) return;
      if (profileResult.kind === 'ok') {
        setProfileState(profileResult.profile);
        setProfileError(null);
      } else if (profileResult.kind === 'no-env') {
        setProfileError('Supabase 接続情報が読み込まれていません。');
      } else {
        setProfileError(profileResult.message);
      }
      setProfileReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setProfile = useCallback((next: Profile) => {
    setProfileState(next);
    setProfileError(null);
    setProfileReady(true);
  }, []);

  const retryProfile = useCallback(async () => {
    const userId = currentUserIdRef.current;
    if (!userId) return;
    setProfileReady(false);
    const result = await ensureProfile(userId);
    if (result.kind === 'ok') {
      setProfileState(result.profile);
      setProfileError(null);
    } else if (result.kind === 'no-env') {
      setProfileError('Supabase 接続情報が読み込まれていません。');
    } else {
      setProfileError(result.message);
    }
    setProfileReady(true);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        currentUserId,
        profile,
        authReady,
        profileReady,
        authError,
        profileError,
        setProfile,
        retryProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useCurrentUserId(): string | null {
  return useContext(AuthContext).currentUserId;
}

export function useProfile(): Profile | null {
  return useContext(AuthContext).profile;
}

export function useSetProfile(): (profile: Profile) => void {
  return useContext(AuthContext).setProfile;
}

/** AUTH DEBUG FIX 01: /account の分岐表示 / debug panel 用。 */
export function useAuthDebug(): {
  authReady: boolean;
  profileReady: boolean;
  authError: string | null;
  profileError: string | null;
  retryProfile: () => Promise<void>;
} {
  const ctx = useContext(AuthContext);
  return {
    authReady: ctx.authReady,
    profileReady: ctx.profileReady,
    authError: ctx.authError,
    profileError: ctx.profileError,
    retryProfile: ctx.retryProfile,
  };
}
