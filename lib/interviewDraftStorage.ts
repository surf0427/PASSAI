import type { QuestionAnswerItem } from '@/app/interview/record/types';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

// 面接練習フォーム（質問・回答セット）の入力途中下書き。
// 保存形式は QuestionAnswerItem[]（JSON）。空配列なら未着手扱い。
const DRAFT_KEY = 'interviewDraft';

export function loadInterviewDraft(): QuestionAnswerItem[] {
  return safeGetStorage<QuestionAnswerItem[]>(DRAFT_KEY, []);
}

export function saveInterviewDraft(items: QuestionAnswerItem[]): void {
  safeSetStorage(DRAFT_KEY, items);
}

export function clearInterviewDraft(): void {
  safeRemoveStorage(DRAFT_KEY);
}
