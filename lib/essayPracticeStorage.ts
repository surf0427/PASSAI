import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

const PROGRESS_KEY = 'essayPracticeData';
const REVIEW_KEY = 'essayPracticeReview';

type EssayPracticeData = {
  hasContent: boolean;
  hasReview: boolean;
};

// APIから返ってくる添削結果の型
export type ReviewResult = {
  totalScore: number;
  verdict: string;
  breakdown: { label: string; score: number }[];
  improvement: string;
  goodPoints: string[];
  weakPoints: string[];
};

// localStorageに保存する型（APIの結果＋クライアント側のメタデータ）
export type SavedReview = ReviewResult & {
  updatedAt: string;          // ISO文字列
  essayBodySnapshot?: string; // 添削時点の本文（既存データとの後方互換のためoptional）
};

// "5月4日 14:32" 形式にフォーマットする
export function formatReviewDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
  } catch {
    return '';
  }
}

export function saveEssayProgress(data: EssayPracticeData): void {
  safeSetStorage(PROGRESS_KEY, data);
}

export function loadEssayProgress(): EssayPracticeData | null {
  return safeGetStorage<EssayPracticeData | null>(PROGRESS_KEY, null);
}

export function saveReviewResult(result: ReviewResult, essayBody: string): void {
  const saved: SavedReview = {
    ...result,
    updatedAt: new Date().toISOString(),
    essayBodySnapshot: essayBody,
  };
  safeSetStorage(REVIEW_KEY, saved);
}

export function loadReviewResult(): SavedReview | null {
  return safeGetStorage<SavedReview | null>(REVIEW_KEY, null);
}
