// 受験チューターAI 用 context 主 entry（純粋関数）。
//
// 役割:
//   - intent に応じて各 sub-builder を呼び分け、section を合成する
//   - 空文字 section は除外し、'\n\n' で連結
//   - userMessage はここに含めない（route 側で末尾に付ける）
//
// 合成ルール:
//   general       : basicInfo + studentProfile
//   statement     : basicInfo + studentProfile + statementContext
//   interview     : basicInfo + studentProfile + interviewContext
//   self_analysis : basicInfo + studentProfile + selfAnalysisContext
//   selfpr        : basicInfo + studentProfile + selfPrContext
//   stabilize     : stabilizationContext のみ（basicInfo + summary）
//
// 関連: [lib/tutor/types.ts](../../tutor/types.ts) / 各 sub-builder

import type { TutorPromptContextInput } from './types';
import { buildTutorBasicInfoSection } from './buildTutorBasicInfoSection';
import { buildTutorStudentProfileContext } from './buildTutorStudentProfileContext';
import { buildTutorStatementContext } from './buildTutorStatementContext';
import { buildTutorInterviewContext } from './buildTutorInterviewContext';
import { buildTutorSelfAnalysisContext } from './buildTutorSelfAnalysisContext';
import { buildTutorSelfPrContext } from './buildTutorSelfPrContext';
import { buildTutorStabilizationContext } from './buildTutorStabilizationContext';

export function buildTutorPromptContext(input: TutorPromptContextInput): string {
  // stabilize は別経路（basicInfo + summary のみ、分析材料を渡さない）
  if (input.intent === 'stabilize') {
    return buildTutorStabilizationContext({
      basicInfo: input.basicInfo,
      studentProfile: input.studentProfile,
    });
  }

  const basicInfoSection = buildTutorBasicInfoSection(input.basicInfo);
  const profileSection = buildTutorStudentProfileContext(input.studentProfile, {
    intent: input.intent,
    preferredProfileField: input.preferredProfileField,
  });

  let extraSection = '';
  switch (input.intent) {
    case 'statement':
      extraSection = buildTutorStatementContext({
        statementDraft: input.statementDraft,
        statementReviewLatest: input.statementReviewLatest,
      });
      break;
    case 'interview':
      extraSection = buildTutorInterviewContext({
        interviewRecordLatest: input.interviewRecordLatest,
        interviewFeedbackLatest: input.interviewFeedbackLatest,
      });
      break;
    case 'self_analysis':
      extraSection = buildTutorSelfAnalysisContext(input.wallHittingResult);
      break;
    case 'selfpr':
      extraSection = buildTutorSelfPrContext(input.selfPRDraft);
      break;
    case 'general':
    default:
      extraSection = '';
      break;
  }

  const parts = [basicInfoSection, profileSection, extraSection].filter((s) => s.length > 0);
  if (parts.length === 0) return '';
  return parts.join('\n\n');
}
