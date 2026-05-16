// 面接履歴 → 「成長メモ」への変換 builder。
//
// 責務:
//   - AI を呼ばない deterministic 変換
//   - localStorage / DB / fetch に触れない pure function
//   - 直近 2 件の有効 record（feedbackJson が存在 + isInterviewFeedback 通過）を比較し、
//     concrete / consistency 軸で weak 件数の変化を集計する
//
// 設計意図:
//   PASSAI の循環「面接練習 → 改善 → 再練習 → 成長実感」を deterministic に張る土台。
//   AI 化を後段に控え、今は粗くて頑健な集計に留める。点数化・グラフ化は意図的に避ける
//   （受験生に圧をかけない方針）。
//
// 入力前提（PR8a / Cr1 marker）:
//   records は **新しい順（最新が records[0]）** で渡される前提。
//   現状 localStorage は append + load 時 reverse で「新しい順」が保証されているが、
//   将来 Supabase 移行や履歴並び替え機能が入った場合、この前提が崩れると memo の
//   「前回 vs 今回」比較が逆転する。並び替え / 復元機能を導入する際は、
//   この関数に「比較基準となる record date」を明示的に引数化（例:
//   buildGrowthMemo(records, refDate?: string)）して順序非依存に修正すること。
//
// 関連:
//   types/interviewGrowth.ts
//   types/interview.ts(InterviewFeedback / LevelEvaluation)
//   lib/interviewRecordStorage.ts(StoredInterviewRecord)
//   lib/interview/isInterviewFeedback.ts(runtime type guard)

import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import type { InterviewFeedback } from '@/types/interview';
import type {
  GrowthAxis,
  GrowthAxisDelta,
  GrowthDirection,
  InterviewGrowthMemo,
} from '@/types/interviewGrowth';
import { isInterviewFeedback } from '@/lib/interview/isInterviewFeedback';

const AXIS_LABELS: Record<GrowthAxis, string> = {
  concrete: '具体性',
  consistency: '一貫性',
};

// 集計対象の軸。MVP は concrete / consistency のみ。
const AXES: readonly GrowthAxis[] = ['concrete', 'consistency'];

// remainingIssues として表示する件数上限。
const REMAINING_ISSUES_MAX = 2;

type ParsedRecord = {
  record: StoredInterviewRecord;
  feedback: InterviewFeedback;
};

// records は新しい順に並んでいる前提（interviewRecordStorage.addInterviewRecord 仕様）。
// 有効 record が 2 件未満なら null を返す（呼び出し側で memo セクション非描画）。
export function buildGrowthMemo(
  records: StoredInterviewRecord[],
): InterviewGrowthMemo | null {
  const valid: ParsedRecord[] = [];
  for (const record of records) {
    const feedback = parseFeedback(record.feedbackJson);
    if (!feedback) continue;
    valid.push({ record, feedback });
    if (valid.length >= 2) break;
  }
  if (valid.length < 2) return null;

  const curr = valid[0];
  const prev = valid[1];

  const axisDeltas: GrowthAxisDelta[] = AXES.map((axis) => {
    const prevWeakCount = countWeak(prev.feedback, axis);
    const currWeakCount = countWeak(curr.feedback, axis);
    return {
      axis,
      label: AXIS_LABELS[axis],
      prevWeakCount,
      currWeakCount,
      direction: directionOf(prevWeakCount, currWeakCount),
    };
  });

  const remainingIssues = curr.feedback.improvements
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .slice(0, REMAINING_ISSUES_MAX);

  return {
    previousDate: pickDate(prev.record),
    currentDate: pickDate(curr.record),
    axisDeltas,
    remainingIssues,
  };
}

// ── 内部 helper ───────────────────────────────────────────────────

// feedbackJson → InterviewFeedback | null。失敗系はすべて silent fail。
// JSON.parse 失敗・guard 通過せず・undefined のいずれも null を返す。
function parseFeedback(feedbackJson: string | undefined): InterviewFeedback | null {
  if (!feedbackJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(feedbackJson);
  } catch {
    return null;
  }
  if (!isInterviewFeedback(parsed)) return null;
  return parsed;
}

function countWeak(feedback: InterviewFeedback, axis: GrowthAxis): number {
  let count = 0;
  for (const q of feedback.perQuestionFeedback) {
    if (q.levelEvaluation[axis] === 'weak') count++;
  }
  return count;
}

// curr が prev より少ない → improved。同数 → unchanged。多い → declined。
function directionOf(prev: number, curr: number): GrowthDirection {
  if (curr < prev) return 'improved';
  if (curr === prev) return 'unchanged';
  return 'declined';
}

// 表示日付の決定: practiceDate（ユーザー入力 YYYY-MM-DD）を優先。
// 空文字 / 未入力なら createdAt（ISO）から YYYY-MM-DD を切り出して fallback する。
function pickDate(record: StoredInterviewRecord): string {
  const practice = record.practiceDate?.trim() ?? '';
  if (practice !== '') return practice;
  return formatCreatedAt(record.createdAt);
}

// ISO 文字列（"2026-05-12T07:30:00.000Z" 等）の先頭 10 文字を取り出す。
// timezone shift を避けるため Date を介さず文字列スライスで処理する。
// 形式が想定外なら空文字（UI 側で「日付なし」として描画する想定）。
function formatCreatedAt(iso: string | undefined): string {
  if (typeof iso !== 'string') return '';
  const datePart = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  return '';
}
