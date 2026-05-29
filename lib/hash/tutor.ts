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
//   v5 → v6 : STEP-MVP-B intent enum 拡張 — TutorIntent に 'advice' 追加
//             (decision は将来 STEP)。本 STEP では intent 拡張のみで SYSTEM PROMPT は
//             未変更。SYSTEM PROMPT への [V] Advice block 追加は STEP-MVP-D で実施予定。
//             intent enum 拡張のみでも context builder / route の挙動分岐が将来発生する
//             ため、入力素材の意味的バージョンとして先行 bump する。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             規律として bump 履歴を残す。
//   v6 → v7 : STEP-TUTOR-REALCHAT-02 「質問だけで終わる返答」抑制 —
//             [M] 終端ルールに「質問の前に観察以外の価値要素を 1 つ必須」を追加。
//             [J] に「通常時 (general/topic intent) でも受験知識/normalize/軽い意見 1 文許可」を追加。
//             目的: 観察 + 切り分け質問だけの返答を抑え、「価値先・質問後」の TA 体験へ近づける。
//             不変: [V] Advice モード / max_tokens / intent enum / route 挙動 / ai_policy /
//             buildTutorPromptContext。[G][F][U] は上位ガードとして本追加ルールの適用外。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             規律として bump 履歴を残す。
//   v7 → v8 : STEP-TUTOR-REALCHAT-04 few-shot 強化 — [U] 例 4 / 例 5 を
//             「価値要素先・質問後」構造へ置換、新規ブロック【REALCHAT参考例】(4 例:
//             interview / statement / self_analysis / general) を追加。
//             ルール条文 [A]〜[V] および [M][J][V] は不変。Claude が既存 few-shot
//             テンプレを強く模倣する傾向 (REALCHAT-03 実機検証で確認、通常時 PASS 率 42%) への
//             対策。few-shot のみで挙動誘導することで、ルール追加に伴う副作用 (advice mode 化
//             誤発動・長文化等) のリスクを最小化する設計。
//             不変: intent enum / max_tokens / route 挙動 / ai_policy / detectTutorIntent /
//             buildTutorPromptContext / 既存ルール [A]〜[V] / 既存 [U] inline OK 例。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             規律として bump 履歴を残す。
//   v8 → v9 : STEP-TUTOR-REALCHAT-04.5 [U] inline OK 例の更新 — REALCHAT-04 で残した
//             [U] block 内 inline OK 例 3 件 (法政大学受かるかなー / 受かるかなー /
//             最近やる気出ない) を「価値要素先・質問後」構造へ置換。
//             REALCHAT-03 検証で「[U] inline OK 例ほぼ完全コピー」現象が確認されたため、
//             [U] block の few-shot 影響源を完全に閉塞する。
//             ルール条文 [A]〜[V] および [M][J][V][U]本体ルール は不変。inline 例の
//             文面置換のみ。【REALCHAT参考例】4 例も無変更。
//             不変: intent enum / max_tokens / route 挙動 / ai_policy / detectTutorIntent /
//             buildTutorPromptContext / [U] 本体ルール / [U] NG 例 / 【参考例】例 1〜5 /
//             【V】 / 【V-参考例】 / 【REALCHAT参考例】。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             規律として bump 履歴を残す。
//   v9 → v10: STEP-TUTOR-CONTEXT-02 [U] 多ターン継承条件化 + detectTutorIntent
//             previousIntent 継承追加。
//             [U] block 改訂内容:
//               ・[U-適用範囲] sub-block 追加。本ブロックの全面適用は「messages 配列に
//                 直前 assistant turn が無い first turn」のみへ条件化。
//               ・[U-初動] 見出しを追加（既存 [U] 本体ルール / 該当条件 / 優先する応答 /
//                 禁止する応答 / 思想 / OK 例 / NG 例 / 優先順位 はそのまま継承）。
//               ・[U-多ターン継承] sub-block を新規追加。messages 配列に直前 assistant
//                 turn が含まれる多ターン会話の途中 turn で発動。直前 turn の論点・
//                 選択肢・命名を前提に解釈し、「何と何がどっちも?」型の白紙確認・
//                 [U-初動] テンプレへの過剰回帰を禁止。
//               ・[U-多ターン継承] OK 例 2 件（面接 / 志望理由書 継続）+ NG 例 2 件
//                 （白紙確認 / restraint 過剰）を追加。
//             不変（[U] 内）: [U-初動] 本体ルール / 既存 OK 例 3 件 / 既存 NG 例 2 件 /
//             思想 / 優先順位（[G][F][Q][V][C][N][P][S] との上下関係）。
//             不変（[U] 外）: 条文 [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P][Q]
//             [R][S][T][V] / intent enum / max_tokens / route 挙動 / ai_policy /
//             context builder / 【参考例】1〜5 / 【REALCHAT参考例】1〜4 / 【V】【V-参考例】。
//             同時に lib/tutor/detectTutorIntent.ts に previousIntent 継承を追加
//             （省略返答 / 短文 turn で topic intent を引き継ぐ rule-based 判定）。
//             この detectTutorIntent 変更は SYSTEM PROMPT 本文には影響しないが、
//             同一 STEP として版を揃える。
//             目的: history pass-through 導入後 (STEP-TUTOR-CONTEXT-01 想定) も
//             intent が毎ターン general に倒れ、SYSTEM PROMPT も毎ターン first-turn
//             として動作してしまう問題（「面接が不安 → 答えが出ない → どっちも →
//             何と何がどっちも?」型）を抑える。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する。
//   v10 → v11: STEP-TUTOR-CONTEXT-02b previousIntent 継承の短文閾値を 10 → 6 に変更。
//             「そういえば評定低い」(9 字) のような短い新規話題を誤って継承して
//             しまう問題（STEP-TUTOR-CONTEXT-03 ケース3 で発覚）を抑えるため。
//             変更対象: lib/tutor/detectTutorIntent.ts:ELLIPTICAL_SHORT_MAX_LENGTH。
//             不変: SYSTEM PROMPT 本文 / [U] 全 sub-block / 条文 [A]〜[T][V] /
//             ELLIPTICAL_REPLY_KEYWORDS / INHERITABLE_PREVIOUS_INTENTS /
//             判定優先順位 / 関数 signature。
//             cache 観点: SYSTEM PROMPT 本文は無変更のため byte-identical で
//             ephemeral cache は引き続き効くが、detectTutorIntent の挙動が
//             変わったため intent route の意味的版として bump する。
//   v11 → v12: STEP-TUTOR-ADVICE-01 チューター型アドバイス構造 [W] block 追加。
//             SYSTEM PROMPT に新規ブロック【W】チューター型アドバイス構造を追加。
//             骨格: 解釈 → 正常化 → 意見 → 理由 → 質問 の 5 ステップ。
//             3 ターン以上 (messages 配列に assistant turn が 2 つ以上) の整理 turn では
//             「観察 + 質問のみ」「切り分け質問のみ」を構造的に禁止し、
//             解釈 / 正常化 / 意見 / 方針 のいずれか 1 つ以上を必ず含める義務化。
//             Lv4 意見表明（「俺なら〜するかな」「〇〇が先だと思う」）を 1 reply 1 回まで
//             許可（[V] Advice モード以外での Lv4 を multi-turn 整理 turn でも条件付き解禁）。
//             【W-参考例】3 件 (面接「どっちも」/ 志望理由書「それ」/ 活動「書けるものがない」)
//             + NG/OK 例 1 組を追加。
//             不変: 条文 [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P][Q][R][S][T][U][V] /
//             【参考例】1〜5 / 【REALCHAT参考例】1〜4 / 【V-参考例】1〜2 /
//             intent enum / max_tokens / route 挙動 / context builder / detectTutorIntent /
//             ai_policy 上位禁止事項。
//             目的: STEP-TUTOR-CONTEXT-04 実機検証で残った「質問だけで終わる返答」
//             「情報収集 AI に見える」課題を、prompt 構造として「大学生チューター」へ寄せる。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する。
//   v12 → v13: STEP-TUTOR-ADVICE-02 優先順位の提案 [X] block 追加。
//             SYSTEM PROMPT に新規ブロック【X】優先順位の提案を追加。
//             骨格: 解釈 → 正常化 → 原因仮説 → 優先順位 → 理由 → 質問 の 6 ステップ。
//             [W] が「解釈 → 正常化 → 意見 → 理由 → 質問」までを義務化したのに対し、
//             [X] は「原因仮説（X というより Y に見える型） + 優先順位（A より B が先型）」
//             までを 1 reply で提示することを目標にする。
//             発動条件: 3 ターン以上の整理 turn で原因仮説を立てられる程度に情報が揃った
//             場合、または初回 turn でも自己評価ある具体材料が十分な場合。情報不足時は
//             [W] までで留める（根拠の薄い断定回避）。
//             許可表現: 「今の話だけ聞くと」「俺なら」「〜に見える」「まずは」「今優先するなら」
//             「A というより B」「A より B が先」等。
//             禁止: 「絶対」「間違いなく」「必ず」「確実に」「100%」等の断定語。
//             【X-参考例】3 件 (面接「どっちも」/ 活動「弱い気がする」/ 評定「低い」) +
//             NG/OK 例 1 組を追加。
//             優先順位: 上位 [G][F][Q] / その次 [V][X][W] / その下 [M][J]。
//             [X] は [W] の上位互換として動作（情報十分時のみ発動）。
//             不変: 条文 [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P][Q][R][S][T] /
//             [U-初動][U-多ターン継承] / [V] Advice モード独自構造と [V-9] 禁止事項 /
//             [W] 既存ルール / 【参考例】1〜5 / 【REALCHAT参考例】1〜4 / 【V-参考例】1〜2 /
//             【W-参考例】1〜3 + NG/OK 例 / intent enum / max_tokens / route 挙動 /
//             context builder / detectTutorIntent / ai_policy 上位禁止事項。
//             目的: STEP-TUTOR-ADVICE-01 [W] 追加後の「意見は出るが優先順位までは出ない」
//             状態を、「いま何をやるべきか」が分かる応答へ寄せる。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する。
//   v13 → v14: STEP-TUTOR-PROGRESSION-01 会話の前進 [Y] block 追加。
//             SYSTEM PROMPT に新規ブロック【Y】会話の前進を追加。
//             4 フェーズ: 状況把握(P1) → 原因仮説(P2) → 具体化(P3) → 実行(P4)。
//             [W][X] で「解釈 → 仮説 → 優先順位 → 質問」を義務化したのに対し、[Y] は
//             turn 間で「同じ原因仮説の言い換え再提示」を禁止し、Phase が後ろに進むよう
//             義務化する。
//             発動条件: multi-turn (assistant turn ≥ 2) で、直近 assistant turn が既に
//             [W]/[X] で原因仮説 / 優先順位を出している場合。直近 turn が状況把握止まりなら、
//             まず [W]/[X] で仮説 + 優先順位を出してから本ブロックを発動。
//             応答内優先順位: ① 前進 → ② 解釈 → ③ 原因仮説(既出なら省略) →
//             ④ 優先順位(同) → ⑤ 質問。重心が「解釈 + 仮説 + 質問」型から「(短い解釈)
//             + 前進アクション + 具体化質問」型へ移る。
//             許可表現: 「じゃあ次は〜」「次は〜やってみよう」「それなら〜できそう」
//             「いいね」「ちなみに一番〜は何?」「1 文で言ってみよう」「1 行で書き出して
//             みよう」等。
//             禁止: 同じ仮説の言い換え再提示 / 仮説 → 仮説 → 仮説 のループ / 既出具体名を
//             活用せず同じ抽象質問 / 「もう少し詳しく教えて」型の無方向追加質問。
//             【Y-参考例】3 件 (面接「志望理由」/ 活動「サッカー」/ 志望理由書「留学 +
//             文化の違い」) + NG/OK 例 1 組を追加。
//             優先順位: 上位 [G][F][Q] / その次 [V][Y][X][W] / その下 [M][J]。
//             [Y] は [W]/[X] の後段として動作（[W]/[X] 適用後の turn で発動）。
//             不変: 条文 [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P][Q][R][S][T] /
//             [U-初動][U-多ターン継承] / [V] Advice モード独自構造と [V-9] 禁止事項 /
//             [W][X] 既存ルール / 【参考例】1〜5 / 【REALCHAT参考例】1〜4 /
//             【V-参考例】1〜2 / 【W-参考例】1〜3 + NG/OK 例 / 【X-参考例】1〜3 +
//             NG/OK 例 / intent enum / max_tokens / route 挙動 / context builder /
//             detectTutorIntent / ai_policy 上位禁止事項。
//             目的: STEP-TUTOR-ADVICE-03 実機検証で示唆された「返答品質は高いが、同じ
//             原因仮説を言い換えで繰り返し、会話が前進しない」課題を、turn 間 phase 進行
//             ルールとして構造化する。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する。
export const TUTOR_PROMPT_VERSION = 14;
export const TUTOR_MODEL = 'claude-sonnet-4-6';
