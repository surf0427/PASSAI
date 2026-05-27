// /api/tutor の version / model 定数。STEP-LIB-02 で lib/aiInputHash.ts から分離。
// 受験チューターAI route の VERSION / MODEL のみ。
// 値は分離前と完全に同一。
//
// 注: v1 では input hash cache を使わないため Hash type / 関数は作らない:
//   - tutor は plain text 自由文応答で hash 一致率が極めて低い
//   - 仮に一致しても「異なる受験生に同じ応答」となり違和感が出る
//   - cache 化の複雑度に見合うメリットがない
//
// VERSION 定数だけを置く理由:
//   - SYSTEM PROMPT 文言・温度判定・安定化モード等を変更したら必ず bump する規律を残すため
//   - 将来 input hash cache を導入する場合の足場

// PROMPT_VERSION bump 条件:
//   - lib/tutor/tutorPrompt.ts:TUTOR_SYSTEM_PROMPT の文言変更
//   - few-shot example の追加・修正
//   - 禁止語彙リスト / 推奨表現リスト の変更
//   - 温度判定 signal の変更
//   - 安定化モードの動作変更
//   - 危険語パターンの変更
//   - 機能接続候補（4 機能）の変更
//
// bump しない条件:
//   - lib/contextBuilders/tutor/*.ts のロジック変更（出力 string が変わらない場合）
//   - UI 側変更
//   - rate limit / daily limit の数値変更
//
// PROMPT_VERSION bump 履歴:
//   v1 → v2 : v1.1 STEP17 で buildTutorStudentProfileContext.ts に signatureEpisodes
//             section（「経験テーマ: <title>」1 件のみ）を追加。SYSTEM PROMPT / few-shot /
//             禁止語彙は不変だが、context builder の出力 string が変わり同入力でも
//             prompt body が変化するため bump。v1 では input hash cache を使わないため
//             cache miss は発生しないが、規律として bump 履歴を残す。client 側 page.tsx も
//             signatureEpisodes を送るよう拡張済み。
//   v2 → v3 : v1.2 tone redesign — [N][O][P][Q][R][S] 6 blocks added.
//             SYSTEM PROMPT に「雑味の温度設計」「名前呼びプロトコル」「雑味優先順位」
//             「Emotional gravity control」「Artificial youth tone prohibition」
//             「Normalize saturation control」の 6 ブロックを追加。
//             [B][D][E][L] の既存ブロックも新仕様に整合させて update。
//             few-shot を旧 9 例 → 新 3 例(雑味なし / 軽雑味 / [Q] 重相談)に差し替え。
//             条件付き許可: ガチ / マジ / ワンチャン / 沼る / 詰む / メンタル削られる /
//             しんどい / バグる / 笑 / w / 名前呼び(姓+さん)。
//             新規完全禁止([R]): エグい / 界隈 / 解像度高い / 刺さる / 情緒 / 優勝 /
//             案件 / アツい / バチバチ / メロい / しか勝たん / 尊い / わかりみ /
//             すぎて草 / きゅん / 泣ける / エモい / アガる / (笑) / (笑) 等。
//             三層防御・危険語対応・受験領域限定・雑談 redirect は不変。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             規律として bump 履歴を残す。
//   v3 → v4 : v1.3 受験外受け止め拡張 — [T] 1 block added。
//             SYSTEM PROMPT に「受験に直接関係ない話題の扱い + 会話スタイル補足」を追加。
//             部活 / 人間関係 / バイト / 留学 / 趣味 / 挫折 / 価値観 / 将来不安 等を
//             「機械的に拒否しない」「受け止め→整理→自然に受験・進路・自己理解へ接続」
//             する方針を明文化。同時に [A] 役割の 4 つ目を「PASSAI 内機能に 1 つだけ繋ぐ」
//             から「受験・進路・自己理解の整理に必要があれば 4 機能のうち 1 つに自然に
//             繋ぐ」へ書き換え、受験外トピックの受け止めを許容する形へ調整。
//             不変: [I] 4 機能限定 / [G] 危険語プロトコル / [Q] Emotional gravity /
//             [S] Normalize saturation 上限 / [N][O][P][R] 雑味制約 / 三層防御。
//             新規禁止: 「PASSAI は受験専用 AI です」「対応できません」型の機械的拒否、
//             無限深掘り「もっと詳しく話してください」、過剰共感、長文カウンセリング、
//             感情依存形成。
//             few-shot は 3 例維持(v1.3 OK 例は [T] block 内に inline 配置)。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             規律として bump 履歴を残す。
//   v4 → v5 : v1.4 初動の解像度緩和 — [U] 1 block added。
//             SYSTEM PROMPT に「初動の解像度（first-turn analytical restraint）」を追加。
//             一言 / ラフ / 抽象的 / 未言語化の初動 turn では [C] 共感の作り方の
//             「観察+命名+確認」3 点セットを 1 turn 目でフル適用せず、「軽く受け止める
//             → 小さく確認する → そこから整理する」を優先する。
//             禁止: 「"〜できない不安" に近そうです」型の即時心理命名、「本当は〜ですよね」
//             型の即断定、「根本原因は〜」型の即構造化、1 turn 目での命名しきり。
//             思想: PASSAI Chat は「ユーザーを分析する AI」ではなく
//             「ユーザーと一緒に整理する AI」。輪郭が出てから整理に進む。
//             few-shot に 例 4（法政・初動一言）/ 例 5（やる気・疲労系一言）を追加して
//             5 例構成へ。
//             不変: [G][F][Q] は引き続き [U] より上位（first turn でも危険語 / メルト
//             ダウン / 重相談の優先は変わらない）。[C] は first turn 以降の通常 turn で
//             引き続き適用。[N][P][S] 雑味・normalize 上限は first turn でも適用。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             規律として bump 履歴を残す。
export const TUTOR_PROMPT_VERSION = 5;
export const TUTOR_MODEL = 'claude-sonnet-4-6';
