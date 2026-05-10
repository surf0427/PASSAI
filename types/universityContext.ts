// 大学・学部・学科の AI への入力文脈を表す共通型。
//
// 設計意図:
//   将来的に大学DB / アドミッションポリシーDB / 推薦基準DB が整備された際、
//   全機能（自己分析・マッチング・志望理由書・小論文・面接）で同一のコンテキスト型を使えるよう、
//   先行して「器」だけを定義しておく。
//
//   現状（STEP6 時点）:
//     basicInfo.preferences[0] から埋められるのは
//       universityName / facultyName / departmentName / examTypes のみ。
//     他のフィールドはすべて undefined のまま AI に渡る（プロンプト側で省略される）。
//
//   将来（大学DB接続後）:
//     universityId をキーに DB を引き、
//       admissionPolicy / preferredTraits / preferredExperiences /
//       essayThemes / interviewTopics / requiredGpa を埋める。
//
// すべて optional にしてあるのは、DB 接続前の段階でも null/undefined で安全に動作させるため。
export type UniversityContext = {
  // 大学DB接続後に埋まる識別子
  universityId?: string;
  facultyId?: string;
  departmentId?: string;

  // basicInfo から先行で埋められる表示名
  universityName?: string;
  facultyName?: string;
  departmentName?: string;

  // 大学DB接続後に埋まる定性情報
  admissionPolicy?: string;
  preferredTraits?: string[];
  preferredExperiences?: string[];
  essayThemes?: string[];
  interviewTopics?: string[];

  // 大学DB接続後に埋まる定量情報
  requiredGpa?: number;

  // basicInfo から先行で埋められる受験方式
  examTypes?: string[];
};
