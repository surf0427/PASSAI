'use client';

// STEP-AUTH-EMAIL-OPTIN-01:
//   任意メール登録ページ。`supabase.auth.updateUser({ email })` を
//   1 回呼ぶだけのシンプルな form。
//
//   保存先は `auth.users.email`（Supabase 標準）。`profiles` テーブルは
//   触らない（`docs/supabase/phase2_auth_boundary.md` §5.3）。
//
//   - メール登録は任意。未入力で離脱しても基本機能は利用可能。
//   - `updateUser` は即時の保存ではなく、Supabase の email change 確認
//     メール送信を要求するだけ。実際に `auth.users.email` が更新されるのは
//     ユーザーが確認リンクを開いた後。UI 文言・state 名はこの実挙動に
//     合わせて「confirmation-sent」と表現している。
//   - 匿名 session は確認完了まで維持される（ログイン強制は発生しない）。

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  useAuthDebug,
  useCurrentUserId,
} from '@/app/components/AuthProvider';
import { isValidEmailFormat, requestEmailChange } from '@/lib/supabase/email';

type RequestState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'confirmation-sent' }
  | { kind: 'error'; message: string };

export default function AccountEmailPage() {
  const currentUserId = useCurrentUserId();
  const { authReady, authError } = useAuthDebug();

  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [requestState, setRequestState] = useState<RequestState>({
    kind: 'idle',
  });

  // 「送信ボタン押下後」または「一度フォーカスを外した後」のときだけ
  // 形式エラーを表示する。初期表示で赤字が出るのを避ける。
  const formatError = useMemo(() => {
    if (!touched) return undefined;
    if (value === '') return 'メールアドレスを入力してください。';
    if (!isValidEmailFormat(value)) {
      return 'メールアドレスの形式が正しくありません。';
    }
    return undefined;
  }, [value, touched]);

  const submitErrorMessage =
    requestState.kind === 'error' ? requestState.message : undefined;
  const fieldError = formatError ?? submitErrorMessage;

  const isSubmitting = requestState.kind === 'submitting';
  const canEdit = currentUserId !== null && !isSubmitting;
  const canSubmit =
    canEdit && value !== '' && isValidEmailFormat(value);

  async function handleSubmit() {
    setTouched(true);
    if (!currentUserId) {
      setRequestState({
        kind: 'error',
        message: '認証が確立していません。少し待ってからもう一度お試しください。',
      });
      return;
    }
    if (value === '') {
      setRequestState({
        kind: 'error',
        message: 'メールアドレスを入力してください。',
      });
      return;
    }
    if (!isValidEmailFormat(value)) {
      setRequestState({
        kind: 'error',
        message: 'メールアドレスの形式が正しくありません。',
      });
      return;
    }

    setRequestState({ kind: 'submitting' });
    const result = await requestEmailChange({ email: value });
    if (result.kind === 'ok') {
      setRequestState({ kind: 'confirmation-sent' });
      return;
    }
    if (result.kind === 'no-env') {
      setRequestState({
        kind: 'error',
        message: 'ストレージに接続できません。少し時間をおいて再度お試しください。',
      });
      return;
    }
    if (result.kind === 'not-authenticated') {
      setRequestState({
        kind: 'error',
        message: '認証が確立していません。少し待ってからもう一度お試しください。',
      });
      return;
    }
    setRequestState({ kind: 'error', message: result.message });
  }

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
    return null;
  })();

  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
      <PageHeader
        title="メール登録"
        description="メールアドレスを登録すると、端末変更時の復元や重要なお知らせを受け取れるようになります。登録しなくてもPASSAIの基本機能はそのまま使えます。"
      />

      <Card padding="md">
        <div className="space-y-4">
          <AlertBox variant="info">
            メール登録は任意です。登録しなくても PASSAI の基本機能はそのまま使えます。
          </AlertBox>

          <FormField
            label="メールアドレス"
            hint="例: yourname@example.com"
            error={fieldError}
          >
            <Input
              type="email"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (
                  requestState.kind === 'confirmation-sent' ||
                  requestState.kind === 'error'
                ) {
                  setRequestState({ kind: 'idle' });
                }
              }}
              onBlur={() => setTouched(true)}
              placeholder="yourname@example.com"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="email"
              disabled={!canEdit}
            />
          </FormField>

          {requestState.kind === 'confirmation-sent' && (
            <AlertBox variant="success">
              <p>
                確認メールを送信しました。メール内のリンクを開くと登録が完了します。
              </p>
              <p className="mt-1 text-xs">
                確認が完了するまでは、現在の状態のままPASSAIを利用できます。
              </p>
            </AlertBox>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {isSubmitting ? '送信中…' : '保存する'}
            </Button>
            <Link
              href="/account"
              className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
            >
              アカウントに戻る
            </Link>
          </div>

          {statusBanner}
        </div>
      </Card>
    </div>
  );
}
