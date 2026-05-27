// 小論文機能 EssayWorkspace 型集約（STEP A 新規）。
//
// 役割:
//   /essay 機能の改善フロー（深掘り質問のみ）に向けた workspace 型。
//   Phase 1 で最小限の field のみ含める。Phase 2 用 field（sparring 等）は
//   フロー① 着手時に追加する。
//
// 関連:
//   - storage  : lib/essayWorkspaceStorage.ts
//   - mutation : lib/essay/workspaceOps.ts
//   - invariant: docs/essay/essay_workspace_invariants.md
//   - 既存 ReviewResult shape: lib/essayPracticeStorage.ts
//
// STEP A 範囲:
//   この型は定義するが、実際に書き込む経路は STEP B 以降で追加する。
//   improvementInProgress も型として定義のみで、UI は STEP E〜G で実装する。

// 改善ワークの「軸」識別子。
// 5 軸 = breakdown ラベルと一致。improvement = review.improvement（最重要枠）。
// 深掘りテンプレートの選定キーとして使う（STEP E）。
export type BreakdownAxis =
  | '論理構造'
  | '具体性'
  | '説得力'
  | 'テーマ理解'
  | '独自性'
  | 'improvement';

// breakdown 項目 1 個。lib/essayPracticeStorage.ts の ReviewResult.breakdown と同形。
// 同型を types/essay.ts でも持つのは、Phase 1 中の依存方向を
// 「types → lib → storage」の片方向に保つため（types が lib に依存しない）。
export type BreakdownItem = {
  label: string;
  score: number;
};

// 1 回の AI 添削結果に、保存時のメタデータ（createdAt / essayBodySnapshot /
// sourceIssueId）を加えたもの。append-only で reviews 配列に積まれる。
export type ReviewEntry = {
  // 既存 ReviewResult shape を完全保持（lib/essayPracticeStorage.ts と互換）
  totalScore: number;
  verdict: string;
  breakdown: BreakdownItem[];
  improvement: string;
  goodPoints: string[];
  weakPoints: string[];
  // STEP A で追加するメタデータ
  createdAt: string; // ISO
  essayBodySnapshot: string; // この review 時点の本文
  sourceIssueId?: string; // 再添削起点となった issue。初回 review は undefined
};

// AI が生成する改善方針の整理結果（essay STEP F 新規）。
//
// 役割:
//   /api/essay-improve-summary の戻り値であり、improvementInProgress.summary に
//   保存される。本文ドラフトは含まない（ai_policy 準拠：AI が代わりに書かない）。
//
// 内容:
//   - summary: 改善方針の全体像（短い段落 1〜2 文程度）
//   - focusPoints: 強化すべきポイント（箇条書き）
//   - suggestedDirections: 書き直しの方向性（"どんな観点で書き直すか"。本文例ではない）
//
// 絶対にやらないこと:
//   - 本文の段落例
//   - 完成文サンプル
//   - 「こう書きましょう」のフレーズ
export type ImprovementSummary = {
  summary: string;
  focusPoints: string[];
  suggestedDirections: string[];
};

// 改善ワーク 1 個分（issue 単位の Q&A snapshot）。
// 責務分離 UX 修正で導入。1 つの workspace に対して複数の issue work が
// 並行して保持される（同じ workspace 内の issue 切替は conflict ではない）。
export type ImprovementWork = {
  issueId: string; // 'r{reviewIndex}-improvement' or 'r{reviewIndex}-w{index}'
  sourceReviewIndex: number; // どの reviews[i] 由来か。範囲外は normalize で除外
  issueText: string; // 開始時の改善点文言 snapshot
  axis: BreakdownAxis; // 推定された軸（深掘りテンプレ選定キー）
  deepQuestions: string[]; // 開始時のテンプレからの snapshot
  templateVersion: number; // 開始時のテンプレ版（template drift 対策）
  answers: string[]; // deepQuestions と index 対応（length 一致）
  startedAt: string; // ISO
};

// 改善 session（workspace 単位）。複数の issue work を集約する。
// session 粒度は **workspace 単位**（≒ essay 単位）。改善点間の移動で conflict にしない。
// summary / rewriteDraft は workspace-level（全 works を統合して生成）。
export type ImprovementInProgress = {
  // 各 issue の Q&A 状態。Record key === ImprovementWork.issueId（I11）
  works: Record<string, ImprovementWork>;
  summary: ImprovementSummary | null; // AI 改善方針（workspace-level、全 works 統合）
  rewriteDraft: string | null; // rewrite 中の本文。null = rewrite 未開始
  startedAt: string; // 改善 session 開始時刻 ISO
};

// 壁打ち（思考整理）セッション（essay Phase 2 STEP J で追加）。
//
// 役割:
//   /essay/structure/[wid]/sparring で固定テンプレ Q&A に回答するワーク。
//   AI は使わず、テンプレ文字列に placeholder（{conclusion} / {faculty} 等）を
//   置換した質問を snapshot 保存する。
//
// 設計:
//   - 並行不可（workspace あたり単数）。新規セッションは既存値を上書き
//   - questions は開始時に「placeholder 置換済み」の文字列を snapshot する
//     （テンプレ更新で remount しても content drift しない）
//   - answers と questions は同 length（I10 で成文化）
export type SparringSession = {
  questions: string[]; // placeholder 置換後の snapshot
  answers: string[]; // questions と index 対応・同 length
  templateVersion: number; // 開始時のテンプレ版（drift 対策）
  startedAt: string; // ISO
};

// 小論文 1 件分の作業状態。localStorage の essayWorkspaces 配列に LRU 10 件まで格納。
// 1 つの workspace は「同じテーマでの 1 サイクル」を表す。
// 別テーマ・別大学で新規に始めると新 workspace を作る。
export type EssayWorkspace = {
  id: string; // 'ws-{timestamp}-{random4hex}'
  createdAt: string; // ISO
  updatedAt: string; // ISO

  // 練習条件
  target: {
    university: string;
    faculty: string;
    department: string;
    examType: string;
  };

  // テーマ（essayThemes の出力 shape を文字列化で持つ）
  theme: {
    text: string;
    type: string; // EssayThemeCandidate.themeType の文字列表現
    source: string; // 'admission_policy' | 'fallback' 等
    reason: string;
  };

  // ミニ思考欄
  mini: {
    conclusion: string;
    reasonOne: string;
    reasonTwo: string;
  };

  // 本文（正本）。最新 review に対応する本文と一致する（invariant I3）。
  body: string;

  // append-only review 履歴。最大 20 件（invariant I7）。
  reviews: ReviewEntry[];

  // 改善ワーク。並行不可（型で単数を強制）。
  improvementInProgress: ImprovementInProgress | null;

  // 壁打ち（思考整理）セッション。Phase 2 で /essay/structure/[wid]/sparring が使用。
  // 並行不可（型で単数を強制）。Phase 1 経路（/essay-practice）では常に null。
  sparring: SparringSession | null;
};
