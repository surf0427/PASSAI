// 「書き直す対象が見つかりません」表示。STEP-PAGE-03 で page.tsx の inline 定義から切り出し。
//
// 役割:
//   pure JSX rendering。props なし、state / 副作用なし。
//
// 触らない:
//   - storage / fetch / router / URL query / hydration guard / refs / state

'use client';

import { LinkButton } from '@/components/ui/LinkButton';

export function NotFound() {
  return (
    <div className="py-16 text-center">
      <h2 className="text-base font-medium text-slate-900 mb-2">
        書き直す対象が見つかりません
      </h2>
      <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-md mx-auto">
        指定された志望理由書の記録が見つかりませんでした。
      </p>
      <LinkButton href="/statement/improve" variant="primary" size="md">
        書き直し一覧へ戻る
      </LinkButton>
    </div>
  );
}
