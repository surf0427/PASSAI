// STEP8: /api/interview-questions の input hash + 生成済み 2 層質問 同居キャッシュ。
//
// 役割:
//   hashInterviewQuestionsInput() の結果と、対応する AI 生成
//   TwoLayerInterviewQuestions を 1 つの localStorage key にまとめて保存する。
//   同入力なら AI call を skip して questions をそのまま復元する。
//
// 1 key で hash と value を同居させる理由:
//   既存 summarizeCache / statementReviewCache / essayReviewCache と同じ思想。
//   両者は cache key / cache value という不可分の対なので別 key 分離は中途状態に脆い。
//
// 入力 hash との責務分離:
//   StudentProfile.sourceHash は出力素材 hash（dedup 用）で別レーン。
//   本ファイルは AI 入力 hash を cache key として使う。
//
// 関連:
//   - lib/aiInputHash.ts:hashInterviewQuestionsInput
//   - lib/aiCacheLog.ts
//   - app/api/interview-questions/route.ts（cache はクライアント側のみ。route 側には入れない）
//   - app/interview/questions/components/InterviewQuestionForm.tsx（消費者）

import type { TwoLayerInterviewQuestions } from '@/types/interviewQuestions';
import {
  safeGetStorage,
  safeSetStorage,
  safeRemoveStorage,
} from '@/lib/storage/safeStorage';

const STORAGE_KEY = 'interviewQuestionsCache';

export type CachedInterviewQuestions = {
  inputHash: string;
  model: string;
  promptVersion: number;
  savedAt: string;
  questions: TwoLayerInterviewQuestions;
};

export function saveInterviewQuestionCache(cache: CachedInterviewQuestions): void {
  // safeSetStorage が SSR ガード / quota error を吸収する。失敗しても throw しない。
  safeSetStorage(STORAGE_KEY, cache);
}

export function loadInterviewQuestionCache(): CachedInterviewQuestions | null {
  // safeGetStorage が SSR ガード / JSON.parse 失敗を吸収するので、ここでは shape のみ検査する。
  const raw = safeGetStorage<unknown>(STORAGE_KEY, null);
  if (!isRecord(raw)) return null;
  return raw;
}

export function clearInterviewQuestionCache(): void {
  safeRemoveStorage(STORAGE_KEY);
}

// 旧形式 / 破損データを「壊れたまま hit 判定に流す」のを防ぐ最小限の runtime guard。
// hash 一致でも questions が壊れていたら null を返して miss に倒す。
function isRecord(value: unknown): value is CachedInterviewQuestions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.inputHash !== 'string') return false;
  if (typeof v.model !== 'string') return false;
  if (typeof v.promptVersion !== 'number') return false;
  if (typeof v.savedAt !== 'string') return false;
  if (!isQuestions(v.questions)) return false;
  return true;
}

function isQuestions(value: unknown): value is TwoLayerInterviewQuestions {
  if (typeof value !== 'object' || value === null) return false;
  const q = value as { general?: unknown; personalized?: unknown };
  return Array.isArray(q.general) && Array.isArray(q.personalized);
}
