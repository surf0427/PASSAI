'use client';

// STEP-AUTH-P0: メール OTP ログインページ。
//
// 目的:
//   無料プランの無い課金サービスで、課金ユーザーが Mac / スマホ / 別ブラウザでも
//   「同じ auth.users.id」に復帰できる正規ログイン入口。匿名認証では端末ごとに
//   別 user_id が発行され「課金済みなのに別端末で Free 表示」が起きるため、
//   課金前にこのページでメール OTP ログインを通す。
//
// フロー:
//   1. メール入力 → OTP 送信（signInWithEmailOtp({ allowSignup: true })）
//      - 初回購入者（未登録メール）も新規発行、既存ユーザーはログインに使える同一入口。
//   2. メールに届いた 6 桁コードを入力 → verifyEmailOtp で検証しセッション確立。
//      - テンプレートがリンクのみの構成でも、リンク click → /auth/callback で
//        同じ user_id に着地する（コード経路はその UX 改善版）。
//   3. 成功後、`next`（相対パスのみ許可）へ window.location で **フル遷移**。
//      フル遷移により AuthProvider が再マウントし、新セッション（永続ユーザー）を
//      読み直す（client 内 router.push だと state が匿名のまま古くなるため）。
//
// 原則:
//   - identity は auth.users.id（email は復帰のための鍵）。display_user_id は不使用。
//   - profiles.plan / is_qa_user / planGate / webhook には一切触れない。

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { signInWithEmailOtp, verifyEmailOtp } from '@/lib/supabase/auth';
import { isValidEmailFormat } from '@/lib/supabase/email';

const DEFAULT_NEXT = '/mypage';

/**
 * open-redirect 防止: `next` は **同一オリジンの相対パス** のみ許可する。
 * - 先頭が "/" で始まり、"//" や "/\" のような protocol-relative を弾く。
 * - 不正なら DEFAULT_NEXT にフォールバック。
 */
function sanitizeNext(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;
  if (!raw.startsWith('/')) return DEFAULT_NEXT;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_NEXT;
  return raw;
}

type Step =
  | { kind: 'email' }
  | { kind: 'code'; email: string };

function LoginForm() {
  const searchParams = useSearchParams();
  const safeNext = useMemo(
    () => sanitizeNext(searchParams.get('next')),
    [searchParams],
  );

  const [step, setStep] = useState<Step>({ kind: 'email' });

  // ── email step ──
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── code step ──
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const emailFormatError = (() => {
    if (!emailTouched) return undefined;
    if (email === '') return 'メールアドレスを入力してください。';
    if (!isValidEmailFormat(email)) {
      return 'メールアドレスの形式が正しくありません。';
    }
    return undefined;
  })();

  const canSend = !sending && email !== '' && isValidEmailFormat(email);
  const canVerify = !verifying && code.trim().length >= 6;

  async function handleSend() {
    setEmailTouched(true);
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    // allowSignup: 初回購入者（未登録メール）も発行し、既存ユーザーはログイン。
    const result = await signInWithEmailOtp(email, { allowSignup: true });
    setSending(false);
    if (result.kind === 'ok') {
      setStep({ kind: 'code', email });
      setCode('');
      setVerifyError(null);
      setResent(false);
      return;
    }
    if (result.kind === 'no-env') {
      setSendError(
        'ストレージに接続できません。少し時間をおいて再度お試しください。',
      );
      return;
    }
    setSendError(
      'コードを送信できませんでした。メールアドレスを確認して再度お試しください。',
    );
  }

  async function handleVerify() {
    if (step.kind !== 'code' || !canVerify) return;
    setVerifying(true);
    setVerifyError(null);
    const result = await verifyEmailOtp(step.email, code);
    if (result.kind === 'ok') {
      // フル遷移で AuthProvider を再マウントし、新セッションを読み直す。
      window.location.assign(safeNext);
      return;
    }
    setVerifying(false);
    if (result.kind === 'no-env') {
      setVerifyError(
        'ストレージに接続できません。少し時間をおいて再度お試しください。',
      );
      return;
    }
    setVerifyError(
      'コードが正しくないか、有効期限が切れています。再度お試しください。',
    );
  }

  async function handleResend() {
    if (step.kind !== 'code') return;
    setVerifying(false);
    setVerifyError(null);
    const result = await signInWithEmailOtp(step.email, { allowSignup: true });
    if (result.kind === 'ok') {
      setResent(true);
      return;
    }
    setVerifyError('コードを再送できませんでした。少し待って再度お試しください。');
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8 sm:py-10">
      <PageHeader
        title="メールでログイン"
        description="登録したメールアドレスにコードを送ります。Mac でもスマホでも、同じメールでログインすれば同じアカウント（学習データ・契約状態）に戻れます。"
      />

      {step.kind === 'email' ? (
        <Card padding="md">
          <div className="space-y-4">
            <FormField
              label="メールアドレス"
              hint="例: yourname@example.com"
              error={emailFormatError ?? sendError ?? undefined}
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (sendError) setSendError(null);
                }}
                onBlur={() => setEmailTouched(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSend) handleSend();
                }}
                placeholder="yourname@example.com"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="email"
                disabled={sending}
              />
            </FormField>

            <Button
              variant="primary"
              size="md"
              onClick={handleSend}
              disabled={!canSend}
            >
              {sending ? '送信中…' : 'ログインコードを送る'}
            </Button>
          </div>
        </Card>
      ) : (
        <Card padding="md">
          <div className="space-y-4">
            <AlertBox variant="info">
              <span className="font-medium">{step.email}</span>{' '}
              宛にコードを送りました。メールに記載の 6
              桁コードを入力してください。
            </AlertBox>

            {resent && (
              <AlertBox variant="success">
                コードを再送しました。最新のメールをご確認ください。
              </AlertBox>
            )}

            <FormField
              label="認証コード（6桁）"
              hint="メールが届かない場合は迷惑メールフォルダもご確認ください。"
              error={verifyError ?? undefined}
            >
              <Input
                type="text"
                value={code}
                onChange={(e) => {
                  // 数字のみ・最大 6 桁に正規化。
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (verifyError) setVerifyError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canVerify) handleVerify();
                }}
                placeholder="123456"
                autoComplete="one-time-code"
                inputMode="numeric"
                disabled={verifying}
              />
            </FormField>

            <Button
              variant="primary"
              size="md"
              onClick={handleVerify}
              disabled={!canVerify}
            >
              {verifying ? '確認中…' : 'ログイン'}
            </Button>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleResend}
                disabled={verifying}
                className="text-sm font-medium text-brand-600 underline-offset-2 hover:underline disabled:opacity-60"
              >
                コードを再送する
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep({ kind: 'email' });
                  setCode('');
                  setVerifyError(null);
                  setResent(false);
                }}
                className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
              >
                メールアドレスを変更する
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams は Suspense 境界を要求するため wrap する。
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-10 text-sm text-slate-500">
          読み込み中…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
