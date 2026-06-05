import { Card } from '@/components/ui/Card';
import type { PlanId } from '@/lib/billing/plans';
import { PricingCheckoutButton } from './PricingCheckoutButton';

// 2 プラン比較カード（ベーシック / プレミアム）。
// プレミアムは ring-accent-500 + 「おすすめ」フローティングバッジで強調。
// STEP-BILLING-04: CTA は PricingCheckoutButton 経由で Stripe Checkout に結線済み。

type PricingCardProps = {
  name: string;
  price: string;
  description: string;
  features: string[];     // 「含まれる機能」リスト（Feature Flow の 6 機能と一致）
  extras?: string[];      // プレミアム追加要素（あれば下にもう一段表示）
  note: string;           // カード内補足（features の下、CTA の上）
  ctaLabel: string;
  plan: PlanId;           // Stripe Checkout に渡す plan 識別子
  highlight?: boolean;
  badge?: string;
};

function PricingCard({
  name,
  price,
  description,
  features,
  extras,
  note,
  ctaLabel,
  plan,
  highlight,
  badge,
}: PricingCardProps) {
  // 既存 padding（p-6 sm:p-7）が Card primitive の md/lg のどちらとも
  // 完全一致しないため、padding="none" + className で揃える。
  return (
    <Card
      variant={highlight ? 'highlight' : 'default'}
      padding="none"
      className="relative flex flex-col p-6 sm:p-7"
    >
      {badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center bg-accent-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
          {badge}
        </span>
      )}

      <p className="text-sm font-semibold text-slate-700 mb-1">{name}</p>
      <p className="text-xs sm:text-sm text-slate-500 leading-relaxed mb-5">
        {description}
      </p>

      <p className="flex items-end gap-1 mb-6">
        <span className="text-xs text-slate-500 mb-1">月額</span>
        <span
          className={`text-3xl sm:text-4xl font-extrabold leading-none ${
            highlight ? 'text-accent-600' : 'text-brand-600'
          }`}
        >
          {price}
        </span>
        <span className="text-sm text-slate-600 mb-1">円</span>
      </p>

      {/* 含まれる機能（Feature Flow の 6 機能と完全一致させて視覚的な紐付けを作る） */}
      <p className="text-xs font-bold text-slate-500 tracking-wide mb-3">
        含まれる機能
      </p>
      <ul className="space-y-2 mb-5">
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed"
          >
            <PricingCheck highlight={highlight} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* プレミアム追加要素（extras がある場合のみ） */}
      {extras && extras.length > 0 && (
        <>
          <p className="text-xs font-bold text-accent-600 tracking-wide mb-3">
            プレミアム追加要素
          </p>
          <ul className="space-y-2 mb-5">
            {extras.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed"
              >
                <PricingPlus />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 補足ノート（features の役割を 1 行で要約） */}
      <div className="border-t border-slate-100 pt-4 mb-5">
        <p
          className={`text-xs sm:text-sm leading-relaxed ${
            highlight ? 'text-accent-700 font-medium' : 'text-slate-600'
          }`}
        >
          {note}
        </p>
      </div>

      {/* CTA は client side で /api/billing/checkout を叩き Stripe Checkout に遷移する。
          スタイルは旧 <Link> と揃えてある (bg-{brand|accent}-600 / rounded-xl / shadow-sm)。 */}
      <PricingCheckoutButton
        plan={plan}
        label={ctaLabel}
        highlight={highlight}
      />
    </Card>
  );
}

function PricingCheck({ highlight }: { highlight?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`w-4 h-4 mt-0.5 shrink-0 ${
        highlight ? 'text-accent-500' : 'text-brand-500'
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}

// プレミアム追加要素用：「+」アイコンで「追加でつく」感を出す
function PricingPlus() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="w-4 h-4 mt-0.5 shrink-0 text-accent-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" className="bg-slate-50 border-y border-slate-200">
      <div className="mx-auto max-w-4xl px-6 sm:px-8 py-14 sm:py-20">
        <div className="text-center mb-12 sm:mb-14">
          <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight mb-3">
            料金プラン
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            まずは必要な機能から始めて、
            <br className="sm:hidden" />
            対策量に合わせてプランを選べます。
          </p>
        </div>

        {/* 機能リストは Feature Flow の 6 機能と完全一致 → 視覚的に「全部入り」と分かる */}
        <div className="grid gap-6 sm:gap-5 sm:grid-cols-2">
          <PricingCard
            name="ベーシックプラン"
            price="2,980"
            description="まずは総合型・学校推薦型の対策を一通り始めたい人向け。"
            features={[
              '活動整理',
              '自己分析',
              '志望校マッチング',
              '志望理由書支援',
              '小論文支援',
              '面接練習',
            ]}
            note="総合型・学校推薦型対策を、1つの流れで進められます。"
            ctaLabel="ベーシックで始める"
            plan="basic"
          />
          <PricingCard
            name="プレミアムプラン"
            price="4,980"
            description="ベーシックの全機能 + 追加要素つきの上位プラン。"
            features={[
              '活動整理',
              '自己分析',
              '志望校マッチング',
              '志望理由書支援',
              '小論文支援',
              '面接練習',
            ]}
            extras={[
              'AI利用上限を大幅緩和予定',
              '今後の追加機能も優先対応予定',
            ]}
            note="より深く・高頻度で使いたい人向け。"
            ctaLabel="プレミアムで始める"
            plan="premium"
            highlight
            badge="おすすめ"
          />
        </div>

        {/* 「全部入り感」を強調する補足メッセージ：
            料金カードと Feature Flow の繋がりを言語化し、
            「添削だけのサービスではない」ことを明示する */}
        <div className="mt-10 sm:mt-12 mx-auto max-w-2xl bg-white rounded-2xl ring-1 ring-brand-200 shadow-sm p-6 sm:p-8 text-center">
          <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
            PASSAIは、
            <br className="sm:hidden" />
            「添削だけ」ではなく、
            <br />
            <span className="text-brand-600 font-bold">
              活動整理から面接までを1つの流れで進める
            </span>
            ためのサービスです。
          </p>
        </div>

        <p className="mt-6 text-xs text-slate-500 text-center leading-relaxed">
          ※正式な利用回数や機能範囲は、リリース時に変更される場合があります。
        </p>
      </div>
    </section>
  );
}
