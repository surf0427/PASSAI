// 自己分析の「下流共通の中立中間レイヤー」。
//
// WallHittingResult は自己分析フロー内部の作業状態（questions / answers が混ざりやすい）を含むため、
// 下流機能（statement / interview / essay / matching / admission-matching）に直接渡してはいけない。
// 代わりに lib/studentProfile.ts の toStudentProfile() で WallHittingResult からこの型に変換し、
// 下流はすべてこの StudentProfile を読む（段階移行中）。
//
// 含めないもの:
// - questions  → working memory（壁打ちフロー内でしか使わない）
// - answers    → working memory（profile 生成にしか使わない）
// - selfPRDraft / interviewPoints → feature artifact。各機能側で個別に保存・生成する
//
// 含めるもの:
// - 下流に渡って意味がある「中立な学生プロフィール」だけ
//
// 設計詳細: docs に追加予定（StudentProfile の責務境界）。

export type SignatureEpisode = {
  // 「探究：仮説修正の粘り強さ」のような短い見出し（最大 20 字程度）
  title: string;
  // エピソード本体の要約（60〜100 字目安）
  summary: string;
  // 関連する strengths[] のインデックス。プロフィール内整合性のためのキー
  relatedStrengthIdx: number;
};

export type StudentProfile = {
  // 構造の互換性管理。破壊的変更時に bump して toStudentProfile 側で migration する
  version: 1;
  // 生成時刻（ISO）。「いつの profile か」を下流に明示する
  generatedAt: string;
  // 入力素材の hash。同じ素材なら同じ hash になり、再生成判定や cache key に使う
  sourceHash: string;

  // 中立的・下流共通で使える素材
  summary: string;
  strengths: string[];         // 優先度順
  weaknesses: string[];        // 優先度順
  futureConnections: string[];

  // 下流が「strengths 全文を毎回 AI に読ませる」のを避けるためのタグ
  // deterministic に summary / strengths / futureConnections から抽出する
  valueKeywords: string[];

  // 下流の prompt で「具体例を 1 つだけ引きたい」ときの参照源
  // 全件渡すのではなく、strengths と整合する形で 1〜3 件だけ持つ
  signatureEpisodes: SignatureEpisode[];
};
