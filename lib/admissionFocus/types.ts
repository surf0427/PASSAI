// AdmissionFocus 機能の public 型定義のみを置く（STEP1a）。
//
// 責務:
// - public な enum / 型のみ。推定ロジック・定義データ・context 生成は別ファイル。
// - 推定の内部状態（score map など）はここに含めない。後続 STEP で internalTypes.ts に分離予定。
//
// 設計方針:
// - AdmissionFocusInference には scores を持たせない。
//   「点数診断サービス化したくない」という方針を型で固定するため、内部スコアは
//   inferAdmissionFocusType 内部の局所変数 / internalTypes.ts に閉じ込める。
// - hasActivityReport signal は CSV に専用カラムが無いため selection_notes / format の
//   文字列マッチで判定される（後続 STEP1b で実装）。精度が低めの signal である点は
//   inferAdmissionFocusType.ts 冒頭コメントで明記する。
//
// 関連: lib/admissionFocus/admissionFocusDefinitions.ts

export type AdmissionFocusType =
  | 'activity_appeal'
  | 'essay_heavy'
  | 'interview_heavy'
  | 'presentation'
  | 'academic_mixed'
  | 'international'
  | 'unknown';

export type AdmissionFocusSignals = {
  hasEssay: boolean;
  interviewCount: number;
  hasPresentation: boolean;
  hasActivityReport: boolean;
  hasAcademicCondition: boolean;
  hasLanguageRequirement: boolean;
  hasQualificationRequirement: boolean;
};

export type AdmissionFocusInference = {
  primaryType: AdmissionFocusType;
  secondaryTypes: AdmissionFocusType[];
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  signals: AdmissionFocusSignals;
};
