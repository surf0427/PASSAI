// 受験チューターAI の安定化モード（intent='stabilize'）用 minimum context を作る純粋関数。
//
// 含める:
//   - basicInfo compact（buildTutorBasicInfoSection 経由）
//   - StudentProfile.summary のみ（buildTutorStudentProfileContext に intent='stabilize' を渡す）
// 含めない:
//   - strengths / weaknesses / futureConnections / valueKeywords
//   - statement / interview / self-analysis / selfPR の各 context
//
// 目的: メルトダウン signal 検出時に AI に渡す「分析の材料」を物理的に削り、
//       AI 側の分析的応答を構造的に抑制する（safety net）。
//
// 入力欠損時は空文字を返す。

import { buildTutorBasicInfoSection } from './buildTutorBasicInfoSection';
import { buildTutorStudentProfileContext } from './buildTutorStudentProfileContext';

export function buildTutorStabilizationContext(input: {
  basicInfo?: unknown | null;
  studentProfile?: unknown | null;
}): string {
  const basicInfoSection = buildTutorBasicInfoSection(input.basicInfo);

  // StudentProfile は intent='stabilize' を渡して summary のみに絞る
  const profileSection = buildTutorStudentProfileContext(input.studentProfile, {
    intent: 'stabilize',
  });

  const parts = [basicInfoSection, profileSection].filter((s) => s.length > 0);
  if (parts.length === 0) return '';
  return parts.join('\n\n');
}
