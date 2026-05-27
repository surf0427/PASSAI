// 完了済み自己分析ログ履歴の canonical storage。
//
// 役割:
//   /self-analysis/run の summarize 完了時に snapshot を 1 件保存し、
//   /self-analysis/resume が一覧表示・選択に使う配列を提供する。
//
// 「現在の作業 state」(lib/analyzeStorage.ts) とは別レーンであることに注意:
//   - 本ファイル: 完了済み履歴 (append / dedup-by-hash / update)
//   - analyzeStorage.ts: 編集中バッファ (full overwrite)
//
// 書き込みは persistSelfAnalysisLog 経由に限定する。直接 saveSelfAnalysisLogs を
// 呼ぶのは migrate / debug 用途のみとし、それ以外の caller は persist 経由を使う。
//
// Supabase 移行戦略:
//   selfPRs と同じく array shape のため、将来 selfAnalysisLogs テーブルを切る形での
//   移行を想定する。本 module を mirror 経路に差し替えれば良い。Phase1 freeze 期間中は
//   localStorage のみ。

import type { SummaryResult, WallHittingResult } from '@/types/analysis';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'selfAnalysisLogs';

export function loadSelfAnalysisLogs(): SelfAnalysisLog[] {
  return safeGetStorage<SelfAnalysisLog[]>(STORAGE_KEY, []);
}

export function saveSelfAnalysisLogs(logs: SelfAnalysisLog[]): void {
  safeSetStorage(STORAGE_KEY, logs);
}

// summarize 完了時の唯一の書き込み口。
// 同じ summaryInputHash の log が既にあれば content と updatedAt を上書き、
// 無ければ新規 entry を append する。
//
// dedup の意図:
//   - cache hit / 再 summarize（同入力）で重複 entry を増やさない
//   - 同じ入力 hash = 同じ canonical 結果。"歴史的に何回開いたか" は本 layer の責務ではない
//
// id は新規追加時のみ UUID 採番。既存 entry 上書き時は id を保持して
// 「ユーザが UI 上で選択していた log id」との整合性を維持する。
export function persistSelfAnalysisLog(input: {
  summaryInputHash: string;
  analysis: WallHittingResult;
  displayedQuestions: string[];
  answers: string[];
  deepAnswers: string[];
  freeMemo: string;
  summary: SummaryResult;
}): SelfAnalysisLog {
  const logs = loadSelfAnalysisLogs();
  const now = new Date().toISOString();
  const idx = logs.findIndex((l) => l.summaryInputHash === input.summaryInputHash);

  if (idx >= 0) {
    const merged: SelfAnalysisLog = {
      ...logs[idx],
      ...input,
      updatedAt: now,
    };
    const next = [...logs.slice(0, idx), merged, ...logs.slice(idx + 1)];
    saveSelfAnalysisLogs(next);
    return merged;
  }

  const created: SelfAnalysisLog = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  saveSelfAnalysisLogs([...logs, created]);
  return created;
}
