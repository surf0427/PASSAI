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
//   v14 → v15: 会話品質改修パック (TUTOR-FINAL-02/03/04) + parser 整合 (TUTOR-FINAL-05)。
//             【SYSTEM PROMPT 改訂】
//             ・TUTOR-FINAL-02 [C]/[M]/[N]:
//                 - [C] 観察句頭の多様化ガイド + 代替言い出し 4 種を追加
//                   ([U]: 「{topic}って、〜なんよね」型へのテンプレ収束を抑制)
//                 - [M] 終端ルールに「質問形の多様化 (事実引き出し / 軽い確認 / A/B 二択)」
//                   + 「A/B 二択 2 reply 連続禁止」「3 reply 連続同形質問禁止」を追加
//                 - [N] 半敬体崩しの候補語を 4 → 7 種に拡張、「同一言い回しを 2 reply
//                   連続で使わない」「冒頭 1 文目に同テンプレ毎回禁止」を追加
//             ・TUTOR-FINAL-03 [I]:
//                 - 「発火条件」サブセクション新設 (4 機能ごとにトリガキーワード列挙)
//                 - 形式例 2 → 5 に拡張
//                 - skip license を「発火条件キーワードに該当しないときのみ skip」へ
//                   条件化 (「すべての返答に接続を入れる必要はありません」削除)
//             ・TUTOR-FINAL-04 [I]:
//                 - 発火を「既定」→「必ず出す (MUST)」へ強化、出力しなければ違反扱い
//                 - 発火優先順位を明示 (interview > statement > selfpr > self_analysis)
//                   + 具体例 4 つ
//                 - 「→」prefix を独立 MUST rule 化 (parseTutorReply.ts:ARROW_PREFIX_PATTERN
//                   仕様を理由として記述)
//                 - 発火 = MUST と押し付けトーン禁止を分離して明示
//                 - キーワード追加: 「この大学を選んだ理由」「深掘り質問」「ガクチカ」
//                   「アピールポイント」「自分がわからない」「自己PRが書けない」
//             【parser 整合 (TUTOR-FINAL-05)】
//             ・lib/tutor/parseTutorReply.ts FEATURE_KEYWORDS を 2-tier 構造へ:
//                 - STRONG tier: 明示的 PASSAI 機能名 (「面接練習」「面接対策」
//                   「面接機能」「志望理由書機能」「志望理由書」「自己PR」「PR文」
//                   「ガクチカ」「自己分析」「壁打ち」「強み整理」)。
//                   優先順位 interview > statement > selfpr > self_analysis
//                   (SYSTEM PROMPT [I] と一致)
//                 - BARE tier (fallback): bare 名詞 「志望理由」「志望動機」「面接」。
//                   STRONG で no-match の場合のみ評価。
//                   後方互換のため statement → interview 順を保持
//             【不変】
//             ・条文 [A][B][D][E][F][G][H][J][K][L][O][P][Q][R][S][T] /
//               [U-初動][U-多ターン継承] / [V] Advice モード独自構造と [V-9] 禁止事項 /
//               [W][X][Y] 既存ルール / 【参考例】1〜5 / 【REALCHAT参考例】1〜4 /
//               【V-参考例】1〜2 / 【W-参考例】1〜3 + NG/OK 例 / 【X-参考例】1〜3 +
//               NG/OK 例 / 【Y-参考例】1〜3 + NG/OK 例 / intent enum / max_tokens /
//               route 挙動 / context builder / detectTutorIntent /
//               detectTutorStabilization / detectTutorSuggestedFeature /
//               ai_policy 上位禁止事項 / TutorFeature enum (4 機能) /
//               ParsedTutorReply / TutorReplySuggestion 戻り値 shape /
//               FEATURE_LINKS whitelist / ARROW_PREFIX_PATTERN。
//             【測定 (TUTOR-FINAL-04 QA, n=16)】
//             ・機能誘導発火率: 9/16 (FINAL-03) → 12/16 (FINAL-04)
//             ・期待 feature 一致率: 8/14 → 11/13 eligible
//             ・「→」prefix 付与率: 8/9 → 12/12 (100%)
//             【測定 (TUTOR-FINAL-05 parser, n=17)】
//             ・17/17 pass。ユーザー指定 6 spec 全 pass、後方互換ゼロ回帰、negative 2 件 pass。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             SYSTEM PROMPT 本文と parser を改訂したため bump 規律として版を更新する。
//   v15 → v16: Advice Mode 発動保証 (TUTOR-FINAL-06)。
//             【SYSTEM PROMPT 改訂】
//             ・[V-1b] intent=advice の検出サブセクション新設 (MUST):
//                 - SYSTEM PROMPT は static const のため AI は単独で「今回 turn の intent」を
//                   判別できない構造ギャップを明文化
//                 - user prompt 末尾に turn qualifier 行が含まれる場合、それを intent=advice
//                   シグナルとして採用し [V-2] 以降の出力構造 (4〜6 文・300〜500 字・
//                   5 ステップ) を必ず適用するルールを追加
//                 - [J] の「80〜200 字」「質問 1 個」「『私』主語禁止」は advice turn では
//                   適用しないことを再度明示
//                 - qualifier 行自体を AI 出力に含めない指示を追加 (UX 上の混乱回避)
//             【route 改訂 (app/api/tutor/route.ts)】
//             ・intent=advice の検出時に userPrompt 末尾へ turn qualifier 1 行を append:
//                 「（本 turn: intent=advice。SYSTEM PROMPT の [V] block を必ず発動して
//                   ください — 4〜6 文 / 300〜500 字 / 5 ステップ構造 (受け止め → 整理・命名
//                   → 受験知識推奨 → 根拠 → 次アクション)。本 qualifier 行は AI 出力には
//                   含めないでください。）」
//             ・buildTutorUserPrompt の signature 不変、構造変更なし、append のみ
//             ・既存 max_tokens=800 (STEP-MVP-E) と整合
//             【測定 (TUTOR-FINAL-06 QA, n=15、全件 intent=advice)】
//             ・Advice 発動率: 0/15 → 14/15 = 93% (chars >= 300 & sentences >= 4)
//             ・平均字数: 約 140 字 (監査値) → 375.2 字
//             ・字数範囲: 130-170 (監査値) → 295-495 (1 件のみ 295、他 14 件 300-500)
//             ・Lv4 意見 ([V-4] 「私なら」等): 7/15 (allowed/not-required)
//             ・次アクション具体性: 9/15 (「1 文だけ」「1 行だけ」等)
//             ・qualifier 行の出力漏れ: 0/15 (prompt 抑止が完全遵守)
//             【不変】
//             ・条文 [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P][Q][R][S][T][U] /
//               [V-1][V-2][V-3][V-4][V-5][V-6][V-7][V-8][V-9] 既存ルール (本 STEP は
//               [V-1b] の追加のみ・既存 V-* 改変なし) / [W][X][Y] / 【参考例】1〜5 /
//               【REALCHAT参考例】1〜4 / 【V-参考例】1〜2 / 【W-参考例】1〜3 + NG/OK 例 /
//               【X-参考例】1〜3 + NG/OK 例 / 【Y-参考例】1〜3 + NG/OK 例 /
//               intent enum / max_tokens / context builder / detectTutorIntent /
//               detectTutorStabilization / detectTutorSuggestedFeature /
//               parseTutorReply / TutorFeature enum (4 機能) /
//               ParsedTutorReply / TutorReplySuggestion 戻り値 shape /
//               FEATURE_LINKS whitelist / ARROW_PREFIX_PATTERN / ai_policy 上位禁止事項。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             SYSTEM PROMPT 本文と route 経路を改訂したため bump 規律として版を更新する。
//   v16 → v17: interview redirect 確実性回復 (TUTOR-FINAL-07)。
//             【SYSTEM PROMPT [I] 改訂】
//             ・[I] に「[U] first-turn restraint および 【REALCHAT参考例】との関係」
//               サブセクションを新設 (約 26 行追加):
//                 - [U] と [I] が別レイヤーである旨を明示。[U] は本文側の構造
//                   (観察+命名急がず軽く受け止める + 確認) を制御し、[I] の末尾
//                   redirect 行を抑制しないことを明文化
//                 - 【REALCHAT参考例】R-1〜R-4 は本文構造（「価値要素先・質問後」
//                   200 字以内）の few-shot にすぎず、末尾 redirect 行の有無は
//                   examples の対象外であることを明示。R-1〜R-4 が body-only で
//                   あることを「redirect skip 許可」と誤解しないよう指示
//                 - [I] redirect を抑制してよい先行 block を [G] 危険語 /
//                   [F] 安定化 / [Q] Emotional gravity の 3 つに明示限定。
//                   [U] first-turn restraint は本抑制リストに含まれないことを明記
//                 - counter-example 1 件追加: R-1 と同入力「面接が苦手なんです」
//                   に対し、body は R-1 と同等構造 + 末尾 redirect 1 行を付ける形を明示
//             【目的】
//             TUTOR-FINAL-04 で唯一残った I1「面接が苦手なんです」での arrow 不発火を
//             解消する。root cause は REALCHAT R-1 が body-only few-shot として
//             AI に学習されており、[I] の MUST rule よりも few-shot の影響が
//             強かったため。[I] 内に明示的な disambiguation + counter-example を
//             加えることで AI の重み付けを矯正する。
//             【測定 (TUTOR-FINAL-07 QA, n=10)】
//             ・I1「面接が苦手なんです」: ✗ → ✓ (arrow 発火、parser interview 分類)
//             ・interview 短文 first-turn (4 ケース): 4/4 = 100% 発火
//             ・stabilize 抑制 (STAB1「もう無理」/ STAB2「受験やめたい」): 2/2 保持
//             ・REALCHAT R-2/R-3 type 入力 (志望理由書が書けない / 強みが分からない):
//               regression なし、いずれも arrow 発火
//             ・generic no-fire (G1「やる気」/ G2「親が反対」): 2/2 正しく抑制
//             ・全体 10/10 = 100% pass、押し売り感ゼロ、reply 長 79-151 字 で baseline 維持
//             【不変】
//             ・条文 [A][B][C][D][E][F][G][H][J][K][L][M][N][O][P][Q][R][S][T] /
//               [U-初動][U-多ターン継承] / [V-1][V-1b][V-2〜V-9] Advice モード /
//               [W][X][Y] 既存ルール / 【参考例】1〜5 / 【REALCHAT参考例】1〜4
//               (本文は無変更・[I] 内で referential disambiguation のみ) /
//               【V-参考例】1〜2 / 【W-参考例】1〜3 + NG/OK 例 /
//               【X-参考例】1〜3 + NG/OK 例 / 【Y-参考例】1〜3 + NG/OK 例 /
//               intent enum / max_tokens / route 挙動 (qualifier append 含む) /
//               context builder / detectTutorIntent / detectTutorStabilization /
//               detectTutorSuggestedFeature / parseTutorReply / TutorFeature enum
//               (4 機能) / ParsedTutorReply / TutorReplySuggestion 戻り値 shape /
//               FEATURE_LINKS whitelist / ARROW_PREFIX_PATTERN / ai_policy 上位禁止事項。
//             ・本 STEP の変更は SYSTEM PROMPT [I] block 内 1 箇所への追加のみ
//               (約 26 行)。他の prompt block / parser / route / context builder /
//               types は無変更。
//             v1 では input hash cache を使わないため cache miss は発生しないが、
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する。
//   v17 → v18: Supabase student context injection
//             (STEP-TUTOR-SUPABASE-CONTEXT-OUTPUT-01)。
//             /api/tutor の Claude 呼び出し前に、server-side で Supabase の auth-scoped
//             永続層（self_analysis_logs）を userId scope で read し、保存済み生徒情報を
//             要約した SYSTEM block（【保存済みの生徒情報（自己分析）】）を追加注入する。
//             - 新規: lib/contextBuilders/tutorContext.ts
//                 (loadTutorStudentContext / buildTutorSupabaseContextSection)
//             - route: gate 成功後・Claude call 前に load → section 化し、systemBlocks の
//                 block 3（dynamic / cache 対象外）として push。空なら block を足さない。
//             - 取得失敗 / 未ログイン / データ不足でも throw せず '' に倒し Tutor は通常動作。
//             【データソース注記】当初想定の basic_info / student_profile / diagnosis /
//             activity mirror は Phase1 anonymous write-only（user_id 列・SELECT policy 無し）
//             で server-side read 不可のため、今回は唯一 read 可能な auth-scoped table
//             self_analysis_logs のみを source とする。残り 3 種は当該 mirror に user_id +
//             SELECT policy を足す schema STEP（Phase2）後の次フェーズに残す。
//             【不変】TUTOR_SYSTEM_PROMPT 本文は byte-identical（block 1 cache hit 不変）。
//             追加 block は dynamic で cache breakpoint より後段のため prompt cache は無影響。
//             条文 [A]〜[Y] / few-shot / 禁止語彙 / 温度判定 / 安定化 / 危険語 / 機能接続
//             候補 / intent enum / max_tokens / parser / detectTutorIntent / 既存 body 由来
//             studentContext（block 2）はいずれも不変。
//             SYSTEM PROMPT 本文は無変更だが、studentContext 注入経路を追加したため
//             意味的版（v10→v11 detectTutorIntent / v5→v6 intent enum と同種）として bump する。
//   v18 → v19: Supabase basic_info / diagnosis / activity context injection
//             (STEP-TUTOR-CONTEXT-PHASE2-CONNECT-01)。
//             lib/contextBuilders/tutorContext.ts に server-side loader を 3 本追加し、
//             auth-scoped durable（basic_info_logs §41 / diagnosis_logs §44 /
//             activity_logs §47）を userId scope で read して studentContext へ統合する。
//             - basic_info: 学年 / 受験方式 / 志望校・志望分野（各最大 3）。氏名・評定・
//                 欠席等の PII は読まない。
//             - diagnosis: resultType を会話補助 hint へ言い換え（固定タイプ名は出さない）。
//             - activity: カテゴリ別件数のみ（narrative 本文は読まない）。
//             buildTutorSupabaseContextSection は 4 source を 1 つの【保存済みの生徒情報】
//             section に統合（空 source は行省略 / 全空なら ''）。冒頭に「参考情報・最新発言
//             優先・矛盾時は確認」を明記。section 全体 1200 字 cap。
//             【不変】TUTOR_SYSTEM_PROMPT 本文は byte-identical（block 1 cache hit 不変）。
//             追加情報は dynamic block 3（cache breakpoint より後段）に載るため prompt cache
//             は無影響。/api/tutor/route.ts の接続位置・systemBlocks 構成・既存 self_analysis
//             挙動・既存 body 由来 block 2 はいずれも不変（import 名も不変で route 無変更）。
//             SQL 未 apply で table 不存在でも各 loader は never-throw で no-op（500 にしない）。
//             SYSTEM PROMPT 本文は無変更だが、studentContext の情報源を拡張したため
//             意味的版として bump する。
//   v19 → v20: STEP-TUTOR-PERSONALITY-AND-CONTEXT-01 個別最適化とパーソナリティ改修。
//             Tutor を「受験相談ボット」から「生徒情報を理解した受験専門チューター」へ寄せる。
//             立ち位置を「塾の年近い大学生チューター」と「受験専門コンサルタント」の中間と
//             明示し、(1) 個別最適化を最優先、(2) 受験外は無理に受験へ戻さない、
//             (3) 感情はまず受け止めてから助言、(4) 質問しすぎ防止・価値先・0〜1 問、
//             (5) トーンのカジュアル寄り緩和、を最上位方針として導入する。
//             【SYSTEM PROMPT 改訂】
//             ・冒頭 persona を「専属チューター / TA とコンサルの中間 / 個別最適化」へ書き換え。
//             ・新規ブロック【最重要方針：個別最適化とパーソナリティ】を追加（上位方針として
//               冒頭に配置）。旧来の「語尾は必ず敬体」「文脈参照は 1 要素のみ」型の細則より
//               本ブロック + 改訂後 [B][E][H][T] を優先する旨を明記。上位ガード（[G][F][Q] /
//               ai_policy の本文代筆・合否予測・数値スコア絶対値禁止）は緩和対象外。
//             ・[B] 基本姿勢: 語尾を「敬体維持」→「親しみやすい先輩（半敬体〜軽いタメ口許容）」
//               へ緩和。重トピックは落ち着いた半敬体に寄せる旨を付記。
//             ・[E] 温度感の切り替え: 「語尾敬体は必ず維持」を撤廃。Casual で軽いタメ口
//               （〜だね / 〜だよ / 〜だな / 〜な / 〜と思う / plain 形）を許容。「絶対に
//               超えない上限」の禁止語尾リストから〜だね/〜だよを外し、キャラ語尾・方言キャラ
//               語尾・SNS 語尾（〜じゃん/〜だわ/〜やで/〜ですわ/〜ね♪ 等）のみ禁止へ。
//             ・[H] 文脈データの使い方: 「1 返信 1 要素のみ・間接参照基本」→「受験・進路の
//               話題では積極参照・複数要素可・個別最適化優先」へ緩和。単なる復唱・列挙は引き
//               続き禁止。最新発言優先・矛盾時は最新発言を明記。applicantType ラベル直接出力
//               禁止 / 数値スコア・日付・配列 index の引用禁止 / 同要素 2 ターン連続禁止は不変。
//             ・[T] 受験外話題: (a) 純粋な雑談・日常（旅行/趣味/恋愛/日常会話）は自然な会話と
//               して応答し受験へ無理に接続しない / (b) 進路・自己理解につながる人生の話は従来の
//               受け止め→整理→（必要なら）接続、の 2 モードへ整理。
//             ・[L] 禁止語彙: タメ口語尾リストから〜だね/〜だよ/〜だな を除外（[E] で許容・本
//               リスト対象外と注記）。キャラ語尾・方言キャラ語尾・SNS 語尾は引き続き絶対禁止。
//             ・[W-Lv4] / [X-Lv4] / [V-7]: 「完全タメ口禁止」「[H] 1 要素のみを 2 要素へ緩和」
//               等の旧 [E]/[H] 依存記述を、改訂後の [E]（軽いタメ口許容・キャラ/SNS 語尾禁止）/
//               [H]（複数要素参照可）と整合する文言へ更新。
//             【route / context builder 改訂】
//             ・buildTutorStudentContextSection（dynamic block 2）の利用ルール instruction を
//               「必要なときだけ自然に参照」→「受験・進路では積極活用・個別最適化、ただし復唱
//               回避・雑談では参照しない・最新発言優先」へ更新（出力 string 変更）。
//             【不変】
//             ・上位ガード [G] 危険語プロトコル / [F] 安定化モード / [Q] Emotional gravity /
//               ai_policy（本文代筆・合否予測・進学先価値判断・数値スコア絶対値の禁止）。
//             ・[C] 共感の作り方 / [D] 励まし基準 / [I] 機能接続（4 機能・MUST・→ prefix・
//               優先順位）/ [J] 出力フォーマット字数・絵文字・! 禁止 / [K] subjectGrades /
//               [M] 終端ルール / [N][O][P][S] 雑味・normalize 上限 /
//               [R] SNS 人格・若者演技語彙の完全禁止 / [U][V-1〜V-9][W][X][Y] の構造ルール本体 /
//               【参考例】【REALCHAT参考例】【V/W/X/Y-参考例】/ intent enum / max_tokens /
//               route の qualifier append 経路 / parseTutorReply / detectTutorIntent /
//               Supabase studentContext 注入経路。
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する（v1 では input
//             hash cache 不使用のため cache miss は発生しない。block 1 は byte-identical 性を
//             失うため ephemeral cache は新文言で再構築される）。
//   v20 → v21: STEP-TUTOR-PERSONALITY-AND-CONTEXT-01 CASUAL CHAT MODE 追加。
//             受験外の雑談で「受験相談 AI」ではなく「自然な人間同士の会話相手」として
//             振る舞う規律を明文化する（v20 の [T](a) 純粋雑談を本格 mode へ拡張）。
//             【SYSTEM PROMPT 改訂】
//             ・[T](a) を ── CASUAL CHAT MODE ── として全面拡張:
//                 - 返信の基本順序「リアクション → 感想・考え → 必要なら質問（0〜1 個）」。
//                 - 出力量: 通常 2〜5 文・極端に短い返答禁止・質問だけで終わらない・
//                   短文ユーザーにも最低限リアクション + 感想を加える。
//                 - 感想・考えの許可: 「個人的には〜好き」「〜だと思う」型の軽い感想・好み・
//                   意見を許可（[B]「AI 自身の感情を語らない」の casual chat 例外）。ただし
//                   対ユーザーの依存形成的感情（応援してる / 心配 / いつでも待ってる）と
//                   [L] 自己感情（嬉しい / 心配 / 応援）は引き続き禁止。
//                 - 雑談での保存情報は低頻度・一言程度・主題を奪わない。
//                 - 本モードでは [W][X][Y] 整理構造・[I] 機能接続は発動しない旨を明記。
//                   [J] 絵文字・「!」・本文/模範解答・数値スコア絶対値の禁止は継承。
//                 - 例を差し替え/追加: OK/NG「熱海」/ 保存情報低頻度活用「旅行行こうと思う」/
//                   感情寄り雑談 + 保存情報一言「英語やる気出ない」/ NG「お腹空いた→受験へ」。
//             ・[H] に参照頻度の目安を追加（受験・進路 → 積極 / 感情相談 → 状況次第・重相談時は
//               [Q][F] に従い抑制 / 雑談 → 低頻度・一言程度）。
//             ・[最重要方針] item 2 の例を、terse な質問だけ返答に anchor しないよう
//               2〜5 文の casual 例へ差し替え（CASUAL CHAT MODE への参照を明記）。
//             【不変】v20 までの全ルール（上位ガード [G][F][Q] / ai_policy / [I] 4 機能・MUST /
//             [J] 字数・絵文字・! 禁止 / [W][X][Y] 受験相談 turn での構造 / [V] Advice モード /
//             intent enum / max_tokens / route 経路 / parser / detectTutorIntent /
//             Supabase studentContext 注入）。casual chat か否かは従来通り message 内容から
//             AI が判断する（static prompt のため intent 経路の変更はなし）。
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する。
//   v21 → v22: STEP-TUTOR-PERSONALITY-AND-CONTEXT-01 QUESTION OPTIONALITY 追加。
//             質問を「会話前進の手段（任意）」と位置づけ、会話継続のためだけの質問を禁止する。
//             【SYSTEM PROMPT 改訂】
//             ・[M] 終端ルールに QUESTION OPTIONALITY サブセクションを追加:
//                 - 十分な価値（共感 / リアクション / 分析・助言・提案 / 感想）を渡せた turn は
//                   質問せず自然に終えてよい（質問は必須ではない）。
//                 - 要素の優先順位: ① 共感 → ② リアクション → ③ 分析・助言・提案 →
//                   ④ 必要なら質問。質問は最後の選択肢。面接官のように並べない。
//                 - 避ける質問: 情報収集が目的でない / 会話を引き延ばす / 既に十分回答済みでの質問。
//                 - 「価値ゼロのまま質問もせず終える」は引き続き禁止（REALCHAT-02 と両立）。
//                 - 本方針を [W][X][Y] にも上位適用: 「最後に質問」ステップは次フェーズへ実際に
//                   進める場合のみ置き、十分な助言・次の一歩を渡せた turn は省略可。
//                   [G][F][Q] の上位ガードは従来通り。
//             ・[T] CASUAL CHAT MODE の出力量を「出力量と質問頻度」へ拡張:
//                 - 質問は必須でない / 十分渡せた turn は質問なしで終える /
//                   毎返信で質問しない・体感 2〜3 返信に 1 回程度で自然。
//                 - 例を更新: 熱海 OK を「質問なしで終える」版へ差し替え、熱海 NG に
//                   「会話継続のためだけの質問」を追加。映画の OK（質問なし / 方向を絞る質問あり）
//                   2 例 + NG（助言せず質問だけ）1 例を追加。
//             ・[最重要方針] item 4 を「質問は任意・面接官ではない」へ更新（質問なしで終える
//               許可と [M] QUESTION OPTIONALITY への参照を明記）。
//             【不変】v21 までの全ルール（上位ガード [G][F][Q] / ai_policy / [I] 4 機能・MUST /
//             [J] 字数・絵文字・! 禁止・質問 0〜1 個 / [V] Advice モード / [W][X][Y] の構造本体
//             （終端質問の省略可化のみ・他は不変）/ intent enum / max_tokens / route 経路 /
//             parser / detectTutorIntent / Supabase studentContext 注入）。
//             SYSTEM PROMPT 本文を改訂したため bump 規律として版を更新する。
//   v22 → v23: STEP-DIAGNOSIS-MIGRATION 9タイプ診断（ExamType）対応。
//             tutorContext.ts:loadDiagnosisContext が diagnosis_logs.resultType を number(legacy 1-4)
//             だけでなく string(ExamType 9種) でも hint 化するよう拡張（新 EXAM_DIAGNOSIS_TYPE_HINTS）。
//             SYSTEM PROMPT 本文は不変だが、9タイプ診断ユーザーでは studentContext の diagnosis
//             hint 出力 string が変化し得る（従来は string resultType を無言 skip）。v18→v19（診断
//             context 拡張で bump）と同じ規律で意味的版として bump。タイプ名 / score / 推薦大学 /
//             NG 生文は引き続き渡さない（傾向 hint のみ）。
export const TUTOR_PROMPT_VERSION = 23;
export const TUTOR_MODEL = 'claude-sonnet-4-6';
