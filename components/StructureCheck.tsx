'use client';

import { useMemo } from 'react';
import { analyzeStructure } from '@/lib/structureAnalysis';
import type { StructureAnalysis, StructureElement } from '@/lib/structureAnalysis';
import { Card } from '@/components/ui/Card';

const ELEMENT_LABELS: Record<StructureElement, string> = {
  trigger: 'きっかけ',
  problem: '課題・問題意識',
  action: '行動',
  learning: '学び',
  future: '将来目標',
  universityConnection: '大学との接続',
};

// 重要度順の表示順
const DISPLAY_ORDER: StructureElement[] = [
  'universityConnection',
  'action',
  'learning',
  'problem',
  'trigger',
  'future',
];

type ScoreBadgeProps = { score: 0 | 1 | 2 };

function ScoreBadge({ score }: ScoreBadgeProps) {
  if (score === 2) {
    return (
      <span className="text-xs font-bold text-green-700 bg-green-100 border border-green-200 rounded px-1.5 py-0.5">
        ◎
      </span>
    );
  }
  if (score === 1) {
    return (
      <span className="text-xs font-bold text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
        △
      </span>
    );
  }
  return (
    <span className="text-xs font-bold text-red-700 bg-red-100 border border-red-200 rounded px-1.5 py-0.5">
      ×
    </span>
  );
}

function buildSummary(analysis: StructureAnalysis[]): string {
  const ordered = DISPLAY_ORDER.map((t) => analysis.find((a) => a.type === t)!).filter(Boolean);
  const missing = ordered.filter((a) => a.score === 0);
  const weak = ordered.filter((a) => a.score === 1);
  const priority = [...missing, ...weak].slice(0, 2);

  if (priority.length === 0) return 'すべての要素が揃っています。';

  const names = priority.map((a) => ELEMENT_LABELS[a.type]);
  if (names.length === 1) return `${names[0]}が弱いです`;
  return `${names[0]}と${names[1]}が弱いです`;
}

type Props = {
  text: string;
};

export function StructureCheck({ text }: Props) {
  // analysis は text から決まる純粋な derived state。
  // analyzeStructure は副作用のない純関数なので、useState + useEffect で持たず useMemo で直接導出する。
  const analysis = useMemo<StructureAnalysis[]>(() => {
    if (!text.trim()) return [];
    const result = analyzeStructure(text);
    return DISPLAY_ORDER.map((t) => result.find((a) => a.type === t)!).filter(Boolean);
  }, [text]);

  if (analysis.length === 0) return null;

  const summary = buildSummary(analysis);
  const allGood = analysis.every((a) => a.score === 2);

  return (
    <Card className="mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        志望理由書の構造チェック
      </h3>

      {/* 全体サマリー */}
      <div
        className={`rounded-lg px-4 py-3 mb-4 text-sm font-medium ${
          allGood
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-amber-50 text-amber-800 border border-amber-200'
        }`}
      >
        {summary}
      </div>

      {/* 要素カード一覧 */}
      <div className="space-y-2">
        {analysis.map((item) => (
          <div
            key={item.type}
            className={`border rounded-lg px-4 py-3 ${
              item.score === 2
                ? 'bg-green-50 border-green-100'
                : item.score === 1
                ? 'bg-amber-50 border-amber-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            {/* ヘッダー行 */}
            <div className="flex items-center gap-2 mb-1">
              <ScoreBadge score={item.score} />
              <span
                className={`text-sm font-semibold ${
                  item.score === 2
                    ? 'text-green-900'
                    : item.score === 1
                    ? 'text-amber-900'
                    : 'text-red-900'
                }`}
              >
                {ELEMENT_LABELS[item.type]}
              </span>
            </div>

            {/* 判定理由 */}
            <p className="text-xs text-gray-600 leading-relaxed">{item.reason}</p>

            {/* ヒント（不足時のみ） */}
            {item.score < 2 && (
              <p className="text-xs text-blue-600 mt-1.5">
                → {item.hint}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
