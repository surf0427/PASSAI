// テーマ辞書（決定論・AI 不使用）の single source of truth。
//
// 由来:
//   元は lib/studentProfile.ts 内の private const VALUE_KEYWORD_MAP として
//   valueKeywords 抽出専用に存在していた。STEP-DIVERGENCE-03A で ThemeFrequency builder
//   が同じ辞書を再利用する必要が生じたため、ここへ verbatim lift して両者の single source of
//   truth とした（複製による drift を防ぐ）。
//
// 不変条件:
//   - tag / patterns の値は元の studentProfile.ts 定義から 1 文字も変えない。
//     値を変えると StudentProfile.valueKeywords の出力が drift し、既存 profile との
//     後方互換（sourceHash・下流 prompt）が壊れる。
//   - 消費者:
//       lib/studentProfile.ts (extractValueKeywords) … presence 抽出（最大 8・dedup）
//       lib/contextBuilders/divergence/buildThemeFrequency.ts … document-frequency 集計
//
// 関連: docs/principles/student_profile_contract.md（valueKeywords は deterministic 辞書ベース）

export const VALUE_KEYWORD_MAP: Array<{ tag: string; patterns: string[] }> = [
  { tag: '継続力',           patterns: ['継続', '粘り強', '続け', '長期間', 'やり抜'] },
  { tag: '主体性',           patterns: ['主体', '自ら', '率先', '自分から', 'リーダー'] },
  { tag: '探究心',           patterns: ['探究', '探求', '研究', '仮説', '掘り下', '突き詰'] },
  { tag: '協調性',           patterns: ['協調', 'チーム', '協力', '仲間', '一緒に'] },
  { tag: '論理的思考',       patterns: ['論理', '分析', '構造化', 'データ', '根拠'] },
  { tag: '行動力',           patterns: ['行動', '動いた', '実行', '実践', '取り組ん'] },
  { tag: 'コミュニケーション', patterns: ['対話', '伝え', '聞く', '対人', '交渉'] },
  { tag: '適応力',           patterns: ['適応', '柔軟', '変化', '対応'] },
  { tag: '創造性',           patterns: ['創造', '工夫', '新しい', 'アイデア', '発想'] },
  { tag: '責任感',           patterns: ['責任', '任さ', '担当', '託'] },
  { tag: '国際性',           patterns: ['国際', '英語', '留学', '異文化', 'グローバル'] },
  { tag: '課題解決',         patterns: ['課題解決', '解決', '問題発見', '原因'] },
  { tag: '挑戦',             patterns: ['挑戦', 'チャレンジ', '初めて'] },
];
