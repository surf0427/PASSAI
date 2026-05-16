import Link from 'next/link';
import type { InterviewRecord } from '@/types/interview';
import type { StatementInterviewInsights } from '@/types/statementInterviewInsights';
import { isInterviewFeedback } from '@/lib/interview/isInterviewFeedback';
import { buildStatementImprovementHints } from '@/lib/interview/buildStatementImprovementHints';

type Props = {
  // feedbackJson は storage の StoredInterviewRecord 由来。display 型に optional で
  // 足すだけで上流（List / Client）の型を広げずに済む。未存在のときは CTA 非表示。
  record: InterviewRecord & { feedbackJson?: string };
  onDelete: (id: string) => void;
};

// 改善ヒントは情報密度を抑えるため Card 内で 3 件にトリミング（builder 上限 5 件はそのまま）。
const DISPLAY_HINTS_MAX = 3;

// feedbackJson → StatementInterviewInsights | null。
// 失敗（undefined / parse 失敗 / guard 通過せず / hints 空）はすべて silent fail。
// 既存の improvementSummary 表示パスとは独立。
function deriveInsightsForRecord(
  feedbackJson: string | undefined,
): StatementInterviewInsights | null {
  if (!feedbackJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(feedbackJson);
  } catch {
    return null;
  }
  if (!isInterviewFeedback(parsed)) return null;

  const insights = buildStatementImprovementHints({
    weaknesses: parsed.improvements,
    shallowPoints: parsed.perQuestionFeedback
      .filter((q) => q.levelEvaluation.concrete === 'weak')
      .map((q) => q.improvement),
    contradictionPoints: parsed.perQuestionFeedback
      .filter((q) => q.levelEvaluation.consistency === 'weak')
      .map((q) => q.improvement),
    followUpQuestions: parsed.followUpQuestions
      .map((f) => f.followUps[0])
      .filter((s): s is string => typeof s === 'string'),
  });

  if (insights.hints.length === 0) return null;
  return insights;
}

type Section = {
  heading: string;
  content: string;
};

type SectionStyle = {
  bg: string;
  border: string;
  headingColor: string;
  contentColor: string;
};

function formatDate(dateString: string): string {
  const [year, month, day] = dateString.split('-');
  return `${year}年${month}月${day}日`;
}

// 行頭に見出しパターンが来たら新セクション開始とみなす。
// 対応形式: ①〜⑥ / 1.〜6. / １.〜６. / 1）〜6） / １）〜６）
const HEADING_PATTERN = /^(①|②|③|④|⑤|⑥|[1-6１-６][.)）])/;

// 分割できなかった場合は null を返す（呼び出し側でフォールバック表示）。
function parseImprovementSummary(text: string): Section[] | null {
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of text.split('\n')) {
    if (HEADING_PATTERN.test(line.trim())) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
      }
      currentHeading = line.trim();
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
  }

  return sections.length >= 2 ? sections : null;
}

// 見出し文字列から 1〜6 のセクション番号を返す。判定できなければ 0。
function getSectionNumber(heading: string): number {
  const h = heading.trimStart();
  if (h.startsWith('①') || /^[1１][.)）]/.test(h)) return 1;
  if (h.startsWith('②') || /^[2２][.)）]/.test(h)) return 2;
  if (h.startsWith('③') || /^[3３][.)）]/.test(h)) return 3;
  if (h.startsWith('④') || /^[4４][.)）]/.test(h)) return 4;
  if (h.startsWith('⑤') || /^[5５][.)）]/.test(h)) return 5;
  if (h.startsWith('⑥') || /^[6６][.)）]/.test(h)) return 6;
  return 0;
}

function getSectionStyle(num: number): SectionStyle {
  switch (num) {
    case 1: return { bg: 'bg-blue-50',   border: 'border-blue-200',   headingColor: 'text-blue-700',   contentColor: 'text-blue-900' };
    case 2: return { bg: 'bg-green-50',  border: 'border-green-200',  headingColor: 'text-green-700',  contentColor: 'text-green-900' };
    case 3: return { bg: 'bg-orange-50', border: 'border-orange-200', headingColor: 'text-orange-700', contentColor: 'text-orange-900' };
    case 4: return { bg: 'bg-purple-50', border: 'border-purple-200', headingColor: 'text-purple-700', contentColor: 'text-purple-900' };
    case 5: return { bg: 'bg-gray-50',   border: 'border-gray-200',   headingColor: 'text-gray-600',   contentColor: 'text-gray-800' };
    case 6: return { bg: 'bg-gray-50',   border: 'border-gray-200',   headingColor: 'text-gray-700',   contentColor: 'text-gray-800' };
    default: return { bg: 'bg-gray-50',  border: 'border-gray-200',   headingColor: 'text-gray-600',   contentColor: 'text-gray-800' };
  }
}

export function InterviewHistoryCard({ record, onDelete }: Props) {
  const sections = record.improvementSummary
    ? parseImprovementSummary(record.improvementSummary)
    : null;

  // 旧記録（feedbackJson なし）や schema 不一致は null。null のとき CTA は描画しない。
  const insights = deriveInsightsForRecord(record.feedbackJson);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">

      {/* 上段：練習日・入試方式バッジ */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm font-semibold text-gray-800">
          {formatDate(record.practiceDate)}
        </span>
        <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
          {record.examType}
        </span>
      </div>

      {/* 大学・学部 */}
      <p className="text-base font-semibold text-gray-800 mb-1">{record.universityName}</p>
      <p className="text-sm text-gray-500 mb-4">{record.facultyName}</p>

      {/* 練習相手 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-400">練習相手：</span>
        <span className="text-xs text-gray-700">{record.partner}</span>
      </div>

      {/* 主な質問 */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-500 mb-1">主な質問</p>
        <p className="text-sm text-gray-700 leading-relaxed">{record.mainQuestion}</p>
      </div>

      {/* AIからの改善アドバイス */}
      {record.improvementSummary && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">AIからの改善アドバイス</p>

          {sections ? (
            // 見出しごとに分割して表示
            <div className="flex flex-col gap-2">
              {sections.map((section) => {
                const style = getSectionStyle(getSectionNumber(section.heading));
                return (
                  <div
                    key={section.heading}
                    className={`${style.bg} border ${style.border} rounded-lg px-4 py-3`}
                  >
                    <p className={`text-xs font-semibold ${style.headingColor} mb-1`}>
                      {section.heading}
                    </p>
                    <p className={`text-sm ${style.contentColor} leading-relaxed whitespace-pre-line`}>
                      {section.content}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            // 分割失敗時はそのまま表示
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-line">
                {record.improvementSummary}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 面接から見えた志望理由書の改善ポイント（feedbackJson があるときのみ） */}
      {insights && (() => {
        // 最重要 hint の targetSection を CTA の focus query param に渡す。
        // /statement/edit 側で「どのセクションを直すか」を軽く案内するため。
        const primaryTargetSection = insights.hints[0]?.targetSection;
        const ctaHref = primaryTargetSection
          ? `/statement/edit?focus=${primaryTargetSection}`
          : '/statement/edit';
        return (
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-500 mb-2">
              面接から見えた志望理由書の改善ポイント
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <ul className="space-y-3 mb-3">
                {insights.hints.slice(0, DISPLAY_HINTS_MAX).map((hint, i) => (
                  <li key={i}>
                    <p className="text-sm text-amber-900 leading-relaxed">・{hint.issue}</p>
                    <p className="text-xs text-amber-800 leading-relaxed pl-3 mt-1">
                      → {hint.suggestedDirection}
                    </p>
                  </li>
                ))}
              </ul>
              <Link
                href={ctaHref}
                className="inline-block text-sm font-semibold text-amber-900 hover:text-amber-700 border border-amber-300 hover:border-amber-400 px-4 py-2 rounded-lg transition-colors"
              >
                志望理由書を改善する
              </Link>
            </div>
          </div>
        );
      })()}

      {/* ボタン行 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="text-sm text-blue-600 hover:text-blue-700 border border-blue-300 hover:border-blue-400 font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          詳細を見る
        </button>
        <button
          type="button"
          onClick={() => onDelete(record.id)}
          className="text-sm text-gray-500 hover:text-red-600 border border-gray-300 hover:border-red-300 font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          削除
        </button>
      </div>

    </div>
  );
}
