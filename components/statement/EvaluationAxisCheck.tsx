'use client';

import { useMemo } from 'react';
import {
  getEvaluationAxes,
  checkAxis,
} from '@/lib/admissionEvaluationAxes';
import { Card } from '@/components/ui/Card';
import type {
  EvaluationAxisPreset,
  AxisCheckResult,
} from '@/lib/admissionEvaluationAxes';

type Props = {
  university: string;
  faculty: string;
  text: string;
};

export function EvaluationAxisCheck({ university, faculty, text }: Props) {
  // preset / results は props から決まる純粋な derived state。
  // useEffect + setState で持つ必要がないので useMemo 直計算に寄せる。
  // getEvaluationAxes / checkAxis はいずれも副作用のない純関数。
  const preset = useMemo<EvaluationAxisPreset | null>(() => {
    if (!university.trim() && !faculty.trim()) return null;
    return getEvaluationAxes(university, faculty);
  }, [university, faculty]);

  const results = useMemo<AxisCheckResult[]>(() => {
    if (!preset) return [];
    return preset.axes.map((axis) => checkAxis(text, axis));
  }, [preset, text]);

  if (!preset) return null;

  const missingCount = results.filter((r) => r.status === 'missing').length;

  return (
    <Card className="mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        大学・学部との一致チェック
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        この大学・学部で見られやすい観点です。本文に含まれているか確認しましょう。
        合否の判定ではありません。
      </p>

      {/* 使用中プリセット名 + サマリー */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4">
        <p className="text-xs font-semibold text-blue-700 mb-0.5">
          参照プリセット：{preset.displayName}
        </p>
        {missingCount === 0 ? (
          <p className="text-sm text-blue-800">
            すべての観点に関連する表現が含まれている可能性があります。
          </p>
        ) : (
          <p className="text-sm text-blue-800">
            {missingCount} 件の観点がまだ確認できません。
          </p>
        )}
      </div>

      {/* 評価軸カード */}
      <div className="space-y-2">
        {results.map((result) => (
          <div
            key={result.axis.id}
            className={`border rounded-lg px-4 py-3 ${
              result.status === 'maybe'
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            {/* ヘッダー */}
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs font-semibold rounded px-1.5 py-0.5 border ${
                  result.status === 'maybe'
                    ? 'text-green-700 bg-green-100 border-green-200'
                    : 'text-yellow-700 bg-yellow-100 border-yellow-200'
                }`}
              >
                {result.status === 'maybe' ? '含まれている可能性あり' : '要確認'}
              </span>
              <span
                className={`text-sm font-semibold ${
                  result.status === 'maybe' ? 'text-green-900' : 'text-yellow-900'
                }`}
              >
                {result.axis.label}
              </span>
            </div>

            {/* 説明 */}
            <p className="text-xs text-gray-600 leading-relaxed mb-1">
              {result.axis.description}
            </p>

            {/* 確認質問（要確認の場合は強調） */}
            <p
              className={`text-xs leading-relaxed ${
                result.status === 'missing'
                  ? 'text-blue-600'
                  : 'text-gray-400'
              }`}
            >
              → {result.axis.checkQuestion}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
