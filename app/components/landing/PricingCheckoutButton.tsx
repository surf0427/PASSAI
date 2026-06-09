'use client';

/**
 * STEP-BILLING-04 / STEP-AUTH-P0: PricingSection の CTA を Checkout に結線する
 * client button。
 *
 * 振る舞い:
 *   1. クリック
 *      - 永続ユーザーでない（匿名 / メール未連携）なら checkout せず /login へ誘導。
 *        戻り先（next）は **現在ページに応じて出し分ける**:
 *          - LP（/）上     : `/?plan=<plan>#pricing`（従来どおり #pricing にスクロール）
 *          - /pricing 上   : `/pricing?plan=<plan>`（LP に戻さず /pricing に留める。
 *                            #pricing hash を付けないため smooth scroll も起きない）
 *        → 課金前にメール OTP ログインを通し、別端末でも同一 user_id に復帰可能にする。
 *      - 永続ユーザーなら POST /api/billing/checkout { plan }。
 *   2. 200 { url } → window.location.href = url で Stripe Checkout に遷移
 *   3. 400 email-required → /login へ誘導（メールOTPログインで email を確定させる）。
 *      ※ OTP 導線では login で必ず email が付くため、この退避ケースは実質発生しない。
 *   4. その他のエラー → button 下にエラーメッセージを出す
 *   5. auth 未確定 / loading 中は disabled
 *
 * ログイン後の自動再開:
 *   /login が `next` に `?plan=<plan>` を含めて戻すと（LP / pricing いずれの形でも）、
 *   本コンポーネントが mount 時に URL の `plan` を読み、永続ユーザーになっていれば
 *   checkout を 1 回だけ自動発火する。
 *
 * 親 (PricingSection) のスタイルを維持するため、ボタンの className は
 * 旧 <Link> と同等にする (bg-{brand|accent}-600 / rounded-xl / shadow-sm)。
 */

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuthStatus, useIsMember } from '@/app/components/AuthProvider';
import type { PlanId } from '@/lib/billing/plans';

type Props = {
  plan: PlanId;
  label: string;
  highlight?: boolean;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
  message?: string;
};

// checkout の auto-resume を「セッション中 plan ごとに 1 回だけ」に制限する module
// スコープのガード。useRef はマウント単位のため、checkout 失敗 → /login → 既ログイン
// 判定で /pricing?plan=... へ戻る（soft-nav remount）たびにリセットされ、auto-resume
// が再発火して /api/billing/checkout を連打する（コンソールに 400 が大量発生）。
// module スコープなら soft-nav の remount をまたいで保持されるため連打を止められる。
const autoResumeAttemptedPlans = new Set<string>();

export function PricingCheckoutButton({ plan, label, highlight }: Props) {
  const isMember = useIsMember();
  const status = useAuthStatus();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ログイン後の自動再開を 1 回に限定するガード。
  const autoResumedRef = useRef(false);

  // 認証状態の確定中（loading）と checkout 実行中のみ非活性。
  // guest はクリック可能にし、押下時に /login へ送る（ボタンで止めない）。
  const disabled = loading || status === 'loading';

  // STEP-AUTH-P0: 未ログイン時はログインへ誘導してから checkout に戻す。
  // 戻り先は現在ページで出し分ける。/pricing 上では LP（/?plan=...#pricing）に
  // 戻さず /pricing に留め、#pricing への smooth scroll（画面の上下往復）を避ける。
  function redirectToLogin() {
    const next =
      pathname === '/pricing'
        ? `/pricing?plan=${plan}`
        : `/?plan=${plan}#pricing`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }

  // checkout 失敗後に URL から ?plan= を取り除く。?plan が残ると remount 時に
  // auto-resume の発火条件（params.plan === plan）が成立し続けて連打になるため、
  // 明示的に消す。同一 route の searchParam 変更なので page は再mountされない。
  function clearPlanQuery() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('plan')) return;
    router.replace(pathname, { scroll: false });
  }

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data: CheckoutResponse = await res.json().catch(() => ({}));

      // email 未登録（匿名 / is_anonymous 取得失敗で permanent 扱いだが email=null）。
      // 課金にはメールOTPログインが必須。希望プランを next に保持して /login へ誘導する
      // （redirectToLogin が /login?next=/pricing?plan=<plan> を組み立てる）。
      // setLoading(false) を必ず呼び、ボタンが「読み込み中…」で固まるのを防ぐ。
      if (res.status === 400 && data.error === 'email-required') {
        setError('課金にはメールログインが必要です。ログインページへ移動します。');
        setLoading(false);
        redirectToLogin();
        return;
      }

      if (res.status === 401) {
        setError('ログインが確認できませんでした。ページを再読み込みしてください。');
        setLoading(false);
        clearPlanQuery();
        return;
      }

      if (!res.ok || !data.url) {
        setError(data.message ?? 'チェックアウトを開始できませんでした。');
        setLoading(false);
        clearPlanQuery();
        return;
      }

      // 成功: Stripe Checkout に遷移
      window.location.href = data.url;
    } catch {
      setError('通信エラーが発生しました。時間をおいてお試しください。');
      setLoading(false);
      clearPlanQuery();
    }
  }

  async function handleClick() {
    if (loading || status === 'loading') return;
    // STEP-AUTH-REDESIGN: 課金導線は member（is_anonymous === false）のみ。
    // guest は checkout を一切叩かず client 側で /login?next=/pricing?plan=... へ送る。
    // OTP 完了後はフル遷移で member 確定 → auto-resume で checkout 再開。
    if (!isMember) {
      redirectToLogin();
      return;
    }
    await startCheckout();
  }

  // ログイン完了後 `next=/?plan=<plan>#pricing` で戻ってきたら自動で checkout 再開。
  // setState（startCheckout 内）を effect 本体で同期実行しないよう microtask で遅延。
  useEffect(() => {
    if (autoResumedRef.current) return;
    if (!isMember) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('plan') !== plan) return;
    // module スコープのガード: checkout 失敗 → /login → /pricing?plan=... 復帰の
    // remount をまたいでも「plan ごと 1 回だけ」に制限し、400 連打を止める。
    if (autoResumeAttemptedPlans.has(plan)) return;
    autoResumeAttemptedPlans.add(plan);
    autoResumedRef.current = true;
    const id = window.setTimeout(() => {
      void startCheckout();
    }, 0);
    return () => window.clearTimeout(id);
    // startCheckout / plan は安定参照のため deps から除外（mount 後 1 回起動）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMember, plan]);

  return (
    <div className="mt-auto">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`inline-flex w-full justify-center items-center font-bold text-sm sm:text-base px-6 py-3 rounded-xl shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          highlight
            ? 'bg-accent-600 hover:bg-accent-700 text-white'
            : 'bg-brand-600 hover:bg-brand-700 text-white'
        }`}
      >
        {loading
          ? '読み込み中…'
          : status === 'loading'
            ? '認証情報を読み込み中…'
            : label}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600 leading-relaxed">{error}</p>
      )}
    </div>
  );
}
