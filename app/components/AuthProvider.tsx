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

      // ── STEP-SUPABASE-COMPLETE-03B: tutor 履歴の初回 backfill（fire-and-forget）──
      //
      // profileReady 確定後、userId が確定しているとき（authResult.kind==='ok'）に
      // 1 回だけ起動する。目的: 差分ミラー（mirrorTutorStoreDelta）が初回マウントを
      // skip するため Supabase に上がらない「既存 LS thread」を一括同期し、別端末の
      // 復元対象にする（STEP-SUPABASE-COMPLETE-02 §3 / 03A backfillTutorOnce）。
      //
      // 契約:
      //   - await しない。認証 / profile フローをブロックしない。
      //   - 例外は握りつぶす。backfill 失敗を auth / profile の失敗にしない。
      //   - dynamic import で browser-only な repository / Supabase client を
      //     server bundle に引き込まない（boundary 安全）。
      //   - cancelled guard: アンマウント後は起動しない。
      //   - backfillTutorOnce 自身が flag（supabaseBackfill）で冪等・1 回限り。
      //     再マウント / 再ログインでも二重実行されない（失敗時のみ次回再試行）。
      //
      // 初回 backfill 負荷:
      //   LS の全 thread × message を直列 upsert する（上限 MAX_THREADS=50 ×
      //   MAX_MESSAGES=200, lib/tutorChatStorage.ts）。最悪ケースで一時的に書き込みが
      //   集中し得るが、fire-and-forget のため UI / auth は待たない。
      //   requestIdleCallback 等の遅延起動は本 STEP では導入しない（必要になれば
      //   後続 STEP で計測のうえ判断）。
      if (!cancelled && authResult.kind === 'ok') {
        const backfillUserId = authResult.userId;
        void import('@/lib/repository/tutorRepository')
          .then((mod) => mod.backfillTutorOnce(backfillUserId))
          .catch(() => {});
      }

      // ── STEP-SUPABASE-COMPLETE-04C / 04E-2: selfAnalysisLogs 履歴の同期 ──
      //
      // tutor backfill と同形・同じ場所で起動する独立した 2 本目の fire-and-forget。
      // 同一 dynamic import の chain 内で「上り → 下り」を順に実行する:
      //   1. backfillSelfAnalysisLogsOnce（04C, 上り）:
      //      dualWrite 配線前に localStorage に蓄積された既存ログを Supabase へ
      //      一括同期し durable replica を作る。
      //   2. restoreSelfAnalysisLogsOnce（04E-2, 下り one-way merge）:
      //      別端末で生まれたログを Supabase から取り込み localStorage に merge する。
      //      backfill の後に走らせることで、自端末分を先に SB へ確定させてから
      //      取り込み、未同期の自端末ログを取りこぼさない（STEP-04E-DESIGN §5）。
      //
      // restore の性質:
      //   - 下り one-way merge。削除は非伝播（remote に無い local log を消さない）。
      //   - merge 時は older/original の id を保持し、UI の selectedLogId
      //     （selection identity）を安定させる（mergeSelfAnalysisLogs）。
      //   - 即時再 render は保証しない。mypage の useMemo は LS 書き戻しを自動検知
      //     しないため、mypage / resume への反映は次回 mount / 再訪時でよい
      //     （mypage に subscribe / 強制再 render は足さない＝read 経路を変えない）。
      //
      // 契約（tutor backfill と同一）:
      //   - await しない。認証 / profile フローをブロックしない。
      //   - 例外は握りつぶす。同期失敗を auth / profile の失敗にしない。
      //   - dynamic import で browser-only な repository / Supabase client を
      //     server bundle に引き込まない（boundary 安全）。
      //   - cancelled guard: アンマウント後は起動しない。
      //   - backfillSelfAnalysisLogsOnce / restoreSelfAnalysisLogsOnce はそれぞれ
      //     別の flag（supabaseBackfill の 'selfAnalysisLogs' / 'selfAnalysisLogsRestore'）
      //     で冪等・1 回限り。再マウント / 再ログインでも二重実行されない。
      //   - tutor backfill とはチェーンしない（独立起動）。
      if (!cancelled && authResult.kind === 'ok') {
        const backfillUserId = authResult.userId;
        void import('@/lib/repository/selfAnalysisLogRepository')
          .then((mod) =>
            mod
              .backfillSelfAnalysisLogsOnce(backfillUserId)
              .then(() => mod.restoreSelfAnalysisLogsOnce(backfillUserId)),
          )
          .catch(() => {});
      }

      // ── STEP-SUPABASE-COMPLETE-05C: selfPRs 履歴の初回 backfill（上りのみ）──
      //
      // tutor / selfAnalysisLogs backfill と同形・同じ場所で起動する独立した
      // 3 本目の fire-and-forget。dualWrite 配線前に localStorage（key='selfPRs'）に
      // 蓄積された既存カードを Supabase self_prs へ一括同期し durable replica を作る
      // （STEP-05B backfillSelfPRsOnce）。
      //
      // selfAnalysisLogs と異なり restore（下り）はチェーンしない:
      //   selfPR は delete feature であり、down-sync は delete resurrection を招く。
      //   restore / tombstone は別 STEP（schema preview §6 / §8）。本 STEP は上りのみ。
      //
      // 契約（tutor backfill と同一）:
      //   - await しない。認証 / profile フローをブロックしない。
      //   - 例外は握りつぶす。backfill 失敗を auth / profile の失敗にしない。
      //   - dynamic import で browser-only な repository / Supabase client を
      //     server bundle に引き込まない（boundary 安全）。
      //   - cancelled guard: アンマウント後は起動しない。
      //   - backfillSelfPRsOnce 自身が flag（supabaseBackfill の 'selfPRs'）で
      //     冪等・1 回限り。再マウント / 再ログインでも二重実行されない。
      if (!cancelled && authResult.kind === 'ok') {
        const backfillUserId = authResult.userId;
        void import('@/lib/repository/selfPRRepository')
          .then((mod) => mod.backfillSelfPRsOnce(backfillUserId))
          .catch(() => {});
      }

      // ── STEP-SUPABASE-COMPLETE-06C: statementReviewHistory の初回 backfill（上りのみ）──
      //
      // tutor / selfAnalysisLogs / selfPRs backfill と同形・同じ場所で起動する独立した
      // 4 本目の fire-and-forget。dualWrite 配線（06D）前に localStorage
      // （key='statementReviewHistory'）に蓄積された既存の添削履歴を Supabase
      // statement_review_history へ一括同期し durable replica を作る
      // （STEP-06B/06C backfillStatementReviewHistoryOnce）。
      //
      // selfPRs と同じく restore（下り）はチェーンしない:
      //   添削履歴は delete を伴う feature（id 削除 + 10 件 cap eviction）であり、
      //   down-sync は delete resurrection を招く。restore / tombstone は別 STEP（06E）。
      //   LS の 10 件 cap は DB に反映しない（DB は 10 件超を durable 保持。preview §9）。
      //
      // 契約（tutor backfill と同一）:
      //   - await しない。認証 / profile フローをブロックしない。
      //   - 例外は握りつぶす。backfill 失敗を auth / profile の失敗にしない。
      //   - dynamic import で browser-only な repository / Supabase client を
      //     server bundle に引き込まない（boundary 安全）。
      //   - cancelled guard: アンマウント後は起動しない。
      //   - backfillStatementReviewHistoryOnce 自身が flag（supabaseBackfill の
      //     'statementReviewHistory'）で冪等・1 回限り。再マウント / 再ログインでも
      //     二重実行されない。
      if (!cancelled && authResult.kind === 'ok') {
        const backfillUserId = authResult.userId;
        void import('@/lib/repository/statementReviewHistoryRepository')
          .then((mod) =>
            mod.backfillStatementReviewHistoryOnce({ userId: backfillUserId }),
          )
          .catch(() => {});
      }

      // ── STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: basic_info / diagnosis / activity の
      //    snapshot 型 durable の同期（各 feature 上り backfill → 下り restore）──
      //
      // 先行 4 feature（tutor / selfAnalysisLogs / selfPRs / statementReviewHistory）と
      // 同形・同じ場所で起動する独立した fire-and-forget。各 feature は backfill（上り）の
      // 後に restore（下り・LS 空のときだけ）をチェーンする（selfAnalysisLogs と同方式）。
      //
      // 契約（先行 backfill と同一）:
      //   - await しない。認証 / profile フローをブロックしない。
      //   - 例外は握りつぶす。同期失敗を auth / profile の失敗にしない。
      //   - dynamic import で browser-only な repository / Supabase client を server bundle に
      //     引き込まない（boundary 安全）。cancelled guard: アンマウント後は起動しない。
      //   - 各 once 関数が flag（supabaseBackfill の 'basicInfoLog'/'basicInfoLogRestore' 等）で
      //     冪等・1 回限り。snapshot 型のため restore は LS 空のときだけ取り込む（上書き事故防止）。
      //   - 既存 anonymous mirror（mirrorBasicInfo / mirrorDiagnosis / mirrorActivityData）には
      //     触らない（別経路）。
      if (!cancelled && authResult.kind === 'ok') {
        const backfillUserId = authResult.userId;
        void import('@/lib/repository/basicInfoRepository')
          .then((mod) =>
            mod
              .backfillBasicInfoLogOnce(backfillUserId)
              .then(() => mod.restoreBasicInfoLogOnce(backfillUserId)),
          )
          .catch(() => {});
        void import('@/lib/repository/diagnosisRepository')
          .then((mod) =>
            mod
              .backfillDiagnosisLogOnce(backfillUserId)
              .then(() => mod.restoreDiagnosisLogOnce(backfillUserId)),
          )
          .catch(() => {});
        void import('@/lib/repository/activityRepository')
          .then((mod) =>
            mod
              .backfillActivityLogOnce(backfillUserId)
              .then(() => mod.restoreActivityLogOnce(backfillUserId)),
          )
          .catch(() => {});
      }
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
