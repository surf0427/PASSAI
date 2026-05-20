import type { ImprovementSuggestion } from '@/lib/improvementSuggestions';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';

type Props = {
  suggestion: ImprovementSuggestion;
  rank: number;
  // 保存済み書き直し下書きの軽サマリ。指定があれば「作業の続きがある」サインを 1 行出す。
  // 「分析カード」に戻さないため、textLength のみで充分（チェック数や更新時刻は出さない）。
  draftSummary?: {
    textLength: number;
  };
};

// improve top は「直す軸を選ぶだけ」の作業入口に寄せる。
// 旧版にあった dual-bar / 「あと N 点」 / 「改善の方向性」 / 「なぜ重要なのか」は
// すべて削除し、score 側（target line）と /improve/[slug] 側（reasoning / comment）に委ねる。
export function ImprovementCard({ suggestion, rank, draftSummary }: Props) {
  const { label, route } = suggestion;
  const hasDraft = draftSummary !== undefined;

  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 text-sm font-bold flex items-center justify-center shrink-0 tabular-nums">
          {rank}
        </span>
        <h2 className="text-base sm:text-lg font-bold text-slate-900 flex-1 min-w-0 truncate">
          {label}
        </h2>
      </div>
      {hasDraft && (
        <p className="text-xs text-slate-500 mt-2 tabular-nums">
          下書きあり・{draftSummary.textLength}文字
        </p>
      )}
      <LinkButton
        href={route}
        variant="primary"
        size="md"
        className="w-full mt-4"
      >
        {hasDraft ? '続きを書く →' : '書き直す →'}
      </LinkButton>
    </Card>
  );
}
