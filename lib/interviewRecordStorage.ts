import type { InterviewRecord } from '@/app/interview/history/types';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const INTERVIEW_RECORDS_STORAGE_KEY = 'interview_records';

// InterviewRecord（表示用）にフォーム全入力項目とメタデータを加えた保存用の型。
// localStorage に保存する際はこの型を使用する。
export type StoredInterviewRecord = InterviewRecord & {
  // Deprecated: questionsAsked / myAnswers は旧形式フィールド。
  // 新規保存では questionsAndAnswers（QuestionAnswerItem[]）から生成した文字列を格納するが、
  // 将来は questionsAndAnswers そのものを StoredInterviewRecord に追加することで不要になる。
  // 削除できる条件:
  //   1. StoredInterviewRecord に questionsAndAnswers?: QuestionAnswerPair[] を追加済み
  //   2. 既存ユーザーのすべての旧履歴を移行または破棄済み
  //   3. API（interview-feedback）が questionsAsked / myAnswers フォールバックを削除済み
  //   4. generateInterviewFeedback(myAnswers) フォールバックを削除済み
  questionsAsked: string;
  myAnswers: string;
  whatWentWrong: string;
  feedbackReceived: string;
  selfNoted: string;
  createdAt: string;
  updatedAt: string;
  // AI フィードバックの構造化データ（JSON 文字列）。旧記録は undefined になる
  feedbackJson?: string;
};

// addInterviewRecord に渡す保存前データの型（id / createdAt / updatedAt は storage 側で付与）
export type NewInterviewRecord = Omit<StoredInterviewRecord, 'id' | 'createdAt' | 'updatedAt'>;

// localStorageから練習記録一覧を取得する
// データなし・JSON不正の場合は [] を返す
export function getInterviewRecords(): StoredInterviewRecord[] {
  return safeGetStorage<StoredInterviewRecord[]>(INTERVIEW_RECORDS_STORAGE_KEY, []);
}

// 練習記録一覧をlocalStorageに保存する
export function saveInterviewRecords(records: StoredInterviewRecord[]): void {
  safeSetStorage(INTERVIEW_RECORDS_STORAGE_KEY, records);
}

// 新しい記録を先頭に追加して保存する。保存後の一覧を返す
export function addInterviewRecord(
  record: NewInterviewRecord,
): StoredInterviewRecord[] {
  const now = new Date().toISOString();
  const newRecord: StoredInterviewRecord = {
    ...record,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const current = getInterviewRecords();
  const updated = [newRecord, ...current];
  saveInterviewRecords(updated);
  return updated;
}

// 指定IDの記録を削除して保存する。保存後の一覧を返す
export function deleteInterviewRecord(id: string): StoredInterviewRecord[] {
  const current = getInterviewRecords();
  const updated = current.filter((record) => record.id !== id);
  saveInterviewRecords(updated);
  return updated;
}

// 全記録を削除する
export function clearInterviewRecords(): void {
  safeRemoveStorage(INTERVIEW_RECORDS_STORAGE_KEY);
}
