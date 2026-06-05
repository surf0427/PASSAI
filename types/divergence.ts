// Divergence Layer v1 の中立型。
//
// PreviousOutputSummary は「ある feature で過去に生成・提示済みの助言／論点」を
// 決定論的に圧縮した構造体。出力収束（毎回同じ弱点・同じ改善アクション・同じ論点）を
// 抑えるため、prompt の dynamic user message（Anthropic prompt cache の cached prefix の
// 外側）に suffix として注入する目的で使う。
//
// 設計境界（STEP-DIVERGENCE-FOUNDATION-01 / 02-DESIGN）:
//   - StudentProfile（canonical 人格）とは別レーン。persona を書き換えない / 派生もしない。
//   - これは「出力の記憶」であり、StudentProfile（identity）・UnusedExperience（未使用入力在庫）
//     とは責務が異なる。混ぜない。
//   - 生成は pure 関数（lib/contextBuilders/divergence/*）が担い、AI 呼び出し・副作用を持たない。
//
// v1 適用範囲: Statement Review のみ（Essay / Interview / Self Analysis / Tutor は未対応）。

export type PreviousOutputSummary = {
  // 過去に繰り返し提示された「助言・指摘」（頻度降順・dedup・truncate 済み）。
  //   statement: result.weaknesses[] + result.actions[]
  repeatedAdvice: string[];

  // 過去に繰り返し現れた「テーマ・論点」（頻度降順・dedup・truncate 済み）。
  //   statement: result.strengths[]
  repeatedThemes: string[];

  // 集計根拠。recordsConsidered < 2 のとき反復は定義できないため、
  // builder は両配列を空で返し、prompt builder 側は section ごと省略する。
  basis: {
    recordsConsidered: number;
  };
};

// ユーザーが繰り返し使っているテーマの偏りを可視化した構造体（STEP-DIVERGENCE-03A）。
//
// PreviousOutputSummary（= AI が過去に言った助言の記憶）とは責務が異なる:
//   - source は activityData + StudentProfile（ユーザー記述 / canonical persona）のみ。
//     AI review 出力は絶対に集計しない（PreviousOutputSummary との二重計上を防ぐ）。
//   - 目的は「収束した overused テーマの抑制」ではなく「薄い／未探索テーマの探索」。
//   - count は document-frequency（1 document あたり theme は最大 +1）。term-frequency にしない。
//
// 生成は pure 関数（lib/contextBuilders/divergence/buildThemeFrequency.ts）。AI 不使用。
// v1 適用範囲: Statement Review のみ。
export type ThemeFrequency = {
  // VALUE_KEYWORD_MAP の全 theme を count 降順で。count 0 も保持（未探索テーマこそが探索 signal）。
  themes: { theme: string; count: number }[];
  // count 0（真の未使用）の theme。全て > 0 のときは下位から補完。探索の即時参照用。
  underused: string[];
  // 集計に使った document 数。documentsConsidered < 3 のとき偏りは有意でないため、
  // prompt builder 側は section ごと省略する。
  basis: {
    documentsConsidered: number;
  };
};

// ユーザーがまだ活用できていない可能性のある「経験（活動カード）」を可視化した構造体
// （STEP-DIVERGENCE-04A）。
//
// ThemeFrequency（テーマの偏り＝抽象的資質）とは責務が異なる:
//   - 単位は activityData の「活動カード」（具体的経験：留学 / アルバイト / 部活動 …）。
//   - 「未使用」は断定ではなく「まだ触れられていない可能性」。distinctive identifier の
//     substring 一致で deterministic に判定するため、言い換え参照は false-unused になり得る
//     前提で、探索型 suggestion としてのみ扱う。
//   - source は activityData（インベントリ）× ユーザー記述 + canonical persona（使用面）。
//     AI 出力は usage 判定に使わない。
//
// 生成は pure 関数（lib/contextBuilders/divergence/buildUnusedExperience.ts）。AI 不使用。
// v1 適用範囲: Self PR のみ。
export type UnusedExperience = {
  // まだ活用できていない可能性のある活動カード。token 抑制で上位 N 件 cap。
  unused: {
    id: string;        // activity に native id が無いため category:title から決定論生成
    title: string;     // 表示ラベル（clubName / destination / theme 等）
    category: string;  // 活動カテゴリ（部活動 / 留学 / 探究 …）
  }[];
  // 集計根拠。totalExperiences が少ない（< 3）ときは偏りが有意でないため
  // prompt builder 側は section ごと省略する。
  basis: {
    totalExperiences: number;
    usedExperiences: number;
  };
};
