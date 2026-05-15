export type SelfPR = {
  id: string;
  index: number;
  title?: string;      // ユーザー入力タイトル（未入力なら空文字）
  text: string;
  latestResult: string;
  createdAt?: string;  // 作成日時（ISO string）。既存データは undefined になる
  updatedAt: string;
  // buildSelfPRDraftSeed 由来 PR のみ持つ canonical 入力 hash（= source summary 識別子）。
  // self-pr ページ再訪問時、現在の canonical 入力 hash に対応する PR が無ければ
  // 新規カードを append する判定に使う（重複作成防止）。
  // 既存カードの text / hash は触らない: STEP3 等で summary が更新されたら新規 2 件目を
  // 追加し、STEP1 由来カードはそのまま残す。
  // legacy drain / 手動作成 PR には付けない（undefined）— 自動追加判定の対象外。
  seedInputHash?: string;
};
