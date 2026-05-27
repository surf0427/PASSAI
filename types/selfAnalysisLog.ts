import type { SummaryResult, WallHittingResult } from '@/types/analysis';

// 完了済み自己分析ログ 1 件分の immutable snapshot。
// /self-analysis/run の summarize が完了した時点で 1 件保存され、
// 以降は /self-analysis/resume での選択対象になる。
//
// 「現在の作業 state」(=lib/analyzeStorage.ts の PersistedAnalyzeState) とは別レーン。
// 役割分離:
//   - analyzeState        : 編集中バッファ。step / 入力中 answers の autosave。エントリ単一。
//   - selfAnalysisLogs[]  : 完了済み履歴。summary 確定時の snapshot を蓄積。エントリ複数。
//
// 設計理由 (STEP-LOG-1 投資レポート参照):
//   - id は UUID 固定。content drift に左右されないため、UI の selectedLogId として安定して使える。
//   - summaryInputHash は dedup key。同入力の再 summarize（cache hit など）で重複エントリを増やさない。
//   - analysis / summary は null を許容しない型: log は summary 完了時のみ書き込まれるため。
//   - displayedQuestions は analysis.questions と独立（後者は AI が初回生成した 5 問、前者は
//     ユーザが「再び深掘る」で追加した分も含む実表示順）。両方を持つことで snapshot 整合性を保つ。
export type SelfAnalysisLog = {
  id: string;
  createdAt: string;
  updatedAt: string;
  summaryInputHash: string;
  analysis: WallHittingResult;
  displayedQuestions: string[];
  answers: string[];
  deepAnswers: string[];
  freeMemo: string;
  summary: SummaryResult;
};
