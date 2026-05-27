// 1 個の改善点を表示するカード（STEP D 新規）。
// /essay/improve/[wid] の改善点選択 hub で使う。
//
// 設計原則:
//   - variant は「見た目だけ」を切り替える（サイズ・色・badge スタイル）
//   - 動作分岐（遷移先決定、API call 有無等）は呼び出し側に閉じる
//   - href は呼び出し側で組み立てる（card 内で /essay/improve/... を組まない）
//
// variant:
//   - primary  : review.improvement（最重要枠）の表示用。大きく目立たせる
//   - secondary: review.weakPoints[i] の表示用。やや控えめ
//
// badge は任意（「最重要」「次に改善」等のラベル文字列を呼び出し側で渡す）。

import Link from 'next/link';
import { BUTTON_BASE, BUTTON_VARIANT, BUTTON_SIZE } from '@/components/ui/buttonStyles';

type Variant = 'primary' | 'secondary';

type Props = {
  variant: Variant;
  issueText: string;
  href: string;
  badge?: string;
  // UX 修正: 回答済み（works[issueId].answers に non-empty が存在）かどうかを
  // status badge として表示する。動作分岐は呼び出し側で持つ（card は display のみ）。
  isAnswered?: boolean;
};

const CONTAINER_BY_VARIANT: Record<Variant, string> = {
  primary: 'bg-blue-50 border border-blue-200 rounded-xl p-5',
  secondary: 'bg-white border border-gray-200 rounded-xl p-4',
};

const BADGE_BY_VARIANT: Record<Variant, string> = {
  primary:
    'inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-600 text-white',
  secondary:
    'inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700',
};

const ISSUE_TEXT_BY_VARIANT: Record<Variant, string> = {
  primary: 'text-base font-semibold text-gray-900 leading-relaxed',
  secondary: 'text-sm text-gray-800 leading-relaxed',
};

export function EssayIssueCard({
  variant,
  issueText,
  href,
  badge,
  isAnswered,
}: Props) {
  return (
    <div className={CONTAINER_BY_VARIANT[variant]}>
      <div className="flex items-center gap-2 mb-2">
        {badge && (
          <span className={BADGE_BY_VARIANT[variant]}>{badge}</span>
        )}
        {isAnswered !== undefined && (
          <span
            className={
              isAnswered
                ? 'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700'
                : 'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600'
            }
          >
            {isAnswered ? '✓ 回答済み' : '未対応'}
          </span>
        )}
      </div>
      <p className={`${ISSUE_TEXT_BY_VARIANT[variant]} mb-4`}>{issueText}</p>
      <Link
        href={href}
        className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant === 'primary' ? 'primary' : 'outline']} ${BUTTON_SIZE.sm}`}
      >
        {isAnswered ? '回答を見直す →' : '深掘りする →'}
      </Link>
    </div>
  );
}
