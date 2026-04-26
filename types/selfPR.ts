export type SelfPR = {
  id: string;
  index: number;
  title?: string;      // ユーザー入力タイトル（未入力なら空文字）
  text: string;
  latestResult: string;
  createdAt?: string;  // 作成日時（ISO string）。既存データは undefined になる
  updatedAt: string;
};
