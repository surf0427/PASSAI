'use client';

// STEP-AUTH-02 / AUTH DEBUG FIX 01 / STEP-AUTH-ACCOUNT-REDIRECT-01 /
// STEP-AUTH-EMAIL-OPTIN-01:
//   display_user_id 設定 UI + 観察可能性 + 保存成功時の次画面遷移。
//
// Auth Debug panel は通常画面から削除。auth 不整合の観察可能性は
// `lib/devLog.ts` の console 出力で代替する。

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { AlertBox } from '@/components/ui/AlertBox';
import {
  useAuthDebug,
  useCurrentUserId,
  useProfile,
  useSetProfile,
} from '@/app/components/AuthProvider';
import {
  validateDisplayUserId,
  DISPLAY_USER_ID_MIN_LENGTH,
  DISPLAY_USER_ID_MAX_LENGTH,
} from '@/lib/displayUserId';
import {
  isDisplayUserIdTaken,
  saveDisplayUserId,
} from '@/lib/supabase/profile';
import { ensureProfile } from '@/lib/supabase/profile';

// 保存成功後の遷移先。Header の「基本情報」リンクと同一 route。
const NEXT_ROUTE_AFTER_SAVE = '/input/basic';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export default function AccountPage() {
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const profile = useProfile();
  const setProfile = useSetProfile();
  const { authReady, profileReady, authError, profileError, retryProfile } =
    useAuthDebug();

  const [value, setValue] = useState('');
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    // profile は非同期ロード。未編集（value===''）のときだけ初期値を一度反映し、
    // 以後はユーザー入力を尊重する（意図的な同期。挙動は変更しない）。
    if (profile?.displayUserId && value === '') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(profile.displayUserId);
    }
  }, [profile, value]);

  const validation = useMemo(() => {
    if (value === '') return null;
    return validateDisplayUserId(value);
  }, [value]);

  const isSaving = saveState.kind === 'saving';
  const formatError =
    validation && !validation.ok ? validation.error : undefined;
  const saveErrorMessage =
    saveState.kind === 'error' ? saveState.message : undefined;
  const fieldError = formatError ?? saveErrorMessage;

  // 入力欄: anonymous auth さえ取れていれば編集可能。
  // profile が null でも保存時に ensureProfile を再試行する。
  const canEdit = currentUserId !== null && !isSaving;
  const canSubmit =
    canEdit && validation?.ok === true && value.length > 0;

  async function handleSubmit() {
    if (!currentUserId) {
      setSaveState({
        kind: 'error',
        message: '認証が確立していません。少し待ってからもう一度お試しください。',
      });
      return;
    }
    const v = validateDisplayUserId(value);
    if (!v.ok) {
      setSaveState({ kind: 'error', message: v.error });
      return;
    }

    setSaveState({ kind: 'saving' });

    // profile が無ければ ensure を再試行。失敗したら保存を諦める。
    if (!profile) {
      const ensured = await ensureProfile(currentUserId);
      if (ensured.kind !== 'ok') {
        const reason =
          ensured.kind === 'no-env'
            ? 'Supabase 接続情報が読み込まれていません。'
            : ensured.message;
        setSaveState({
          kind: 'error',
          message: `プロフィール作成に失敗しました: ${reason}`,
        });
        return;
      }
      setProfile(ensured.profile);
      // 自分自身の現行値と同じなら DB UPDATE は不要、そのまま次画面へ。
      if (ensured.profile.displayUserId === value) {
        setSaveState({ kind: 'saved' });
        router.push(NEXT_ROUTE_AFTER_SAVE);
        return;
      }
    } else if (profile.displayUserId === value) {
      setSaveState({ kind: 'saved' });
      router.push(NEXT_ROUTE_AFTER_SAVE);
      return;
    }

    const taken = await isDisplayUserIdTaken({
      displayUserId: value,
      currentUserId,
    });
    if (taken) {
      setSaveState({
        kind: 'error',
        message: 'この ID は既に他のユーザーが使用しています。',
      });
      return;
    }

    const result = await saveDisplayUserId({
      userId: currentUserId,
      displayUserId: value,
    });
    if (result.kind === 'ok') {
      setProfile(result.profile);
      setSaveState({ kind: 'saved' });
      router.push(NEXT_ROUTE_AFTER_SAVE);
      return;
    }
    if (result.kind === 'duplicate') {
      setSaveState({
        kind: 'error',
        message: 'この ID は既に他のユーザーが使用しています。',
      });
      return;
    }
    setSaveState({ kind: 'error', message: result.message });
  }

  // 準備中 / エラー時のステータスメッセージを分岐生成。
  const statusBanner = (() => {
    if (authError) {
      return (
        <AlertBox variant="error">
          匿名認証に失敗しました: {authError}
        </AlertBox>
      );
    }
    if (!authReady) {
      return (
        <p className="text-xs text-slate-500">匿名認証を準備中です…</p>
      );
    }
    if (profileError) {
      return (
        <AlertBox variant="error">
          プロフィール作成に失敗しました: {profileError}
          <button
            type="button"
            onClick={() => {
              void retryProfile();
            }}
            className="ml-2 underline"
          >
            再試行
          </button>
        </AlertBox>
      );
    }
    if (!profileReady) {
      return (
        <p className="text-xs text-slate-500">プロフィールを準備中です…</p>
      );
    }
    return null;
  })();

  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
      <PageHeader
        title="アカウント"
        description="表示用のユーザー ID を設定できます。設定しなくても各機能はそのまま使えます。"
      />

      <Card padding="md">
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            現在の表示 ID:{' '}
            <span className="font-medium text-slate-900">
              {profile?.displayUserId ?? '未設定'}
            </span>
          </div>

          <FormField
            label="表示 ID"
            hint={`${DISPLAY_USER_ID_MIN_LENGTH}〜${DISPLAY_USER_ID_MAX_LENGTH}文字。半角英小文字・数字・アンダースコア。先頭と末尾は英数字。`}
            error={fieldError}
          >
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (saveState.kind === 'saved' || saveState.kind === 'error') {
                  setSaveState({ kind: 'idle' });
                }
              }}
              placeholder="例: yk2026"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={DISPLAY_USER_ID_MAX_LENGTH}
              disabled={!canEdit}
            />
          </FormField>

          {saveState.kind === 'saved' && (
            <AlertBox variant="success">表示 ID を保存しました。</AlertBox>
          )}

          <div>
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {isSaving ? '保存中…' : '保存する'}
            </Button>
          </div>

          {statusBanner}
        </div>
      </Card>
    </div>
  );
}
