// 大学DB 更新ログレイヤ (5 層目・メタ情報)
//
// - master / entries / steps の「実データ」とは独立した、変更履歴のメタ情報レイヤ。
//   target_type と target_id で任意のレイヤーへの soft FK を張る。
// - 現時点は空配列。今後の運用（CSV 再投入 / AI 自動取得 / 人間レビュー）で
//   ログ行が追加されていく想定の「土台」のみ。
// - 値は string 統一。confidence_score も string で保持し、判定は consumer 側で
//   Number() する（他レイヤーと同じ運用）。enum / Union 型を切らない。
// - 現時点ではどこからも import しない。消費者が現れた段階で
//   lib/universities.ts に最小 helper を追加する。
// - 詳細ルールは docs/principles/university_database_usage_guide.md 参照。

export type UpdateLog = {
  log_id: string;
  target_type: string;       // university_master / university_entry / selection_step 等
  target_id: string;         // 対象レコードの ID（school_id / entry_id / detail_id 等）
  update_type: string;       // created / updated / reviewed / imported / verified 等
  update_source: string;     // AI_auto / human_manual / CSV_import 等
  updated_fields: string;    // 変更カラム名。複数なら "field1, field2" のように保持
  confidence_score: string;  // "0.85" 等。閾値運用は将来。空欄も許容
  reviewed_by: string;
  reviewed_at: string;
  notes: string;
};

export const updateLogs: UpdateLog[] = [];
