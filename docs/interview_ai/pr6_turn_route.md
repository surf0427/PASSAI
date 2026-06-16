# Interview AI — PR6 ターン route（/api/interview-ai/turn）

リアルタイム面接の 1 ターン（seed 質問 / 回答 / followup）を扱う route。課金トリガ・冪等化・
所有者検証・ターン上限を実装する。PR0 設計（[pr0_design.md](./pr0_design.md)）+ PR3/PR5 の上に乗る。

> **PR6 完了。次の PR6 以降に進む前提として、本書末尾の監査報告を参照。**

実装:
- route: [app/api/interview-ai/turn/route.ts](../../app/api/interview-ai/turn/route.ts)
- lib: [constants](../../lib/interviewAi/constants.ts) / [stt](../../lib/interviewAi/stt.ts) / [sessionGuard](../../lib/interviewAi/sessionGuard.ts) / [billing](../../lib/interviewAi/billing.ts) / [questionGen](../../lib/interviewAi/questionGen.ts) / [turnStore](../../lib/interviewAi/turnStore.ts)
- schema: `supabase/schema.sql` §61–§62（interview_ai_turns + RLS EXISTS）

---

## 1. 契約

```
POST /api/interview-ai/turn
```

| モード | Content-Type | body | 動作 |
|---|---|---|---|
| kickoff | application/json | `{ sessionId, kickoff: true }` | seed 質問生成（課金なし） |
| text 回答 | application/json | `{ sessionId, answer }` | text 回答保存 + 課金トリガ + followup |
| voice 回答 | multipart/form-data | `sessionId`, `audio` | STT + 課金トリガ + transcript 保存 + followup |
| followup 再試行 | application/json | `{ sessionId, retryFollowup: true }` | followup のみ再生成・再保存（課金なし / §8） |

レスポンス（主なもの）:

| status | body | 意味 |
|---|---|---|
| 201 | `{ question, turnIndex: 0, done: false }` | kickoff: seed 質問 |
| 200 | `{ transcript, turnIndex, done: false, question, questionTurnIndex }` | 回答保存 + followup |
| 200 | `{ transcript, turnIndex, done: true, question: null }` | ターン上限到達（followup なし） |
| 200 | `{ transcript, turnIndex, done: false, question: null, questionError }` | 回答は保存・課金済 / 次質問だけ失敗（明示 surface） |
| 400 | `{ error: 'invalid-body' \| 'empty-answer' \| 'source-mismatch' }` | 入力不正 / source 不整合 |
| 402 | — | （turn では gate しない。quota は session 作成時） |
| 404 | `{ error: 'session-not-found' }` | session 不在 / 所有者不一致 |
| 409 | `{ error: 'session-not-in-progress' \| 'no-pending-question' \| 'turn-limit-reached' \| 'already-started' }` | 状態不整合 |
| 413 | `{ error: 'audio-too-large' \| 'answer-too-large' }` | サイズ超過 |
| 502 | `{ error: 'stt-unavailable' \| 'stt-failed' \| 'question-generation-failed' }` | STT / AI 生成失敗（課金なし） |
| 500 | `{ error: 'turn-save-failed' \| 'turn-load-failed' \| 'turn-failed' }` | Supabase 保存失敗（明示エラー） |

---

## 2. PR6 必須条件の遵守マップ

| 条件 | 実装 |
|---|---|
| §1 route key 統一 | `INTERVIEW_AI_USAGE_ROUTE='interview-ai'`（constants.ts 単一定義）。recordUsage はこの 1 値のみ。`FEATURE_ROUTE_KEYS['interview-ai']=['interview-ai']` と一致 |
| §2 recordUsage 2 箇所のみ | billing.ts の `triggerInterviewAiBilling` を route から **voice STT 成功時**（route.ts:273）と **text 回答保存成功時**（route.ts:321）の 2 箇所でのみ呼ぶ。seed/followup は logAiUsage のみ（questionGen は recordUsage を import しない） |
| §3 compare-and-set | `claimUsageRecording`（`UPDATE ... SET usage_recorded=true WHERE id=:id AND usage_recorded=false`）で行が返った勝者のみ recordUsage |
| §4 所有者・状態確認 | `loadInProgressOwnedSession`: 存在 / `user_id===auth user` / `status='in_progress'` を確認、不一致は reject |
| §5 source 分岐 | voice=STT / text=直接保存。session.source とリクエストモードの不一致は 400 `source-mismatch` |
| §6 音声保存禁止 | 音声は `arrayBuffer()` でメモリ上にのみ載せ transcribe 後破棄。DB / Storage に保存しない。保存は transcript（content）のみ |
| §7 ターン上限 | `INTERVIEW_AI_MAX_ANSWER_TURNS=5`。answer 件数が上限で followup を生成せず done。無限 followup 禁止 |
| §8 失敗時 | STT 失敗 → recordUsage しない（502）。text 保存失敗 → recordUsage しない（保存を先に行い失敗で 500）。Supabase 保存失敗 → 明示 500（best-effort にしない） |

---

## 3. 課金トリガの順序（source 別）

### voice（最初の STT 成功時に課金）

1. 音声を `transcribeAudio`（STT）。**失敗 → recordUsage せず 502**。
2. STT 成功 → `triggerInterviewAiBilling`（compare-and-set → 勝者のみ recordUsage）。STT コストは実発生済みのため保存より先に計上（pr0_design.md §2.2）。
3. transcript を保存。保存失敗 → 明示 500（課金は STT 成功時に確定。STT 原価は実発生）。

### text（最初の回答保存時に課金）

1. 回答テキストを transcript として保存。**保存失敗 → recordUsage せず 500**（§8）。
2. 保存成功 → `triggerInterviewAiBilling`（compare-and-set → 勝者のみ recordUsage）。

> 2 つの順序差は「voice=STT コスト発生点」「text=回答保存点」という課金トリガ定義（pr0_design.md §2）を
> 正しく反映したもの。どちらも compare-and-set により 1 セッション 1 回に冪等化される。

---

## 4. ターンモデル

`interview_ai_turns.turn_index` は session 内 0 始まり連番:

```
0: question (seed)    ← kickoff
1: answer             ← 課金トリガ（最初の回答 / STT）
2: question (followup)
3: answer
...
```

- 回答受付には「直前ターンが question」が必要（`no-pending-question` で弾く）。
- ターン上限は role='answer' の件数（`countAnswerTurns`）。上限到達で followup を生成しない。
- 質問は常に `source='text'`、回答は voice(STT) / text。

---

## 5. STT 境界（プラグイン）

[lib/interviewAi/stt.ts](../../lib/interviewAi/stt.ts) が STT の唯一の入口。

- `INTERVIEW_AI_STT_PROVIDER` 未設定（or 未知）→ `SttUnavailableError`。
- 実プロバイダ（Whisper / Deepgram 等）接続は **別 PR**。本 PR では境界のみ確立。
- text 経路は STT を通さないため **provider なしでも完全動作**（MVP / pr0_design.md §7.2 の text fallback）。
- 音声はメモリ上で transcribe するだけで保存しない（§6）。

---

## 6. 手動検証手順（要 Supabase apply + STT provider）

text 経路（provider 不要）:

1. session 作成（PR5）→ `POST {sessionId, kickoff:true}` → 201 seed question。
2. `POST {sessionId, answer:'...'}` → 200、transcript 保存 + 課金（usage_records に interview-ai/ok 1 件）+ followup。
3. 同 session で再度回答 → 200。usage_records は **増えない**（compare-and-set 冪等）。
4. 上限（5 回答）到達 → `done:true`、followup なし。
5. 他ユーザーの sessionId → 404。completed セッション → 409。

voice 経路（provider 未設定時）:

6. `POST multipart {sessionId, audio}` → 502 `stt-unavailable`、**usage_records は増えない**（§8）。

---

## 7. 監査報告（PR6 完了時 / 必須条件 §9）

| 項目 | 結果 |
|---|---|
| recordUsage 呼び出し箇所 | 実呼び出しは [billing.ts](../../lib/interviewAi/billing.ts) の `triggerInterviewAiBilling` 内 1 箇所のみ。route からは voice STT 成功時（route.ts:273）/ text 保存成功時（route.ts:321）の 2 経路でのみ起動。route key は `'interview-ai'` 固定 |
| compare-and-set 実装箇所 | [billing.ts](../../lib/interviewAi/billing.ts) `claimUsageRecording`（`update usage_recorded=true where usage_recorded=false`）。recordUsage の直前で必ず実行、勝者のみ計上 |
| voice / text 分岐 | route.ts `handleVoiceAnswer`（STT→課金→保存）/ `handleTextAnswer`（保存→課金）。session.source とモード不一致は 400 |
| STT 失敗時 | recordUsage せず 502（`stt-unavailable` / `stt-failed`）。音声は保存しない |
| Supabase 保存失敗時 | 明示 500（`turn-save-failed` / `turn-load-failed`）。best-effort にしない。text 保存失敗時は recordUsage しない |
| tsc 結果 | exit 0 |
| eslint 結果 | exit 0（PR6 追加ファイル） |

→ 詳細な変更ファイル一覧と数値は本 PR の最終報告（チャット）に記載。

---

## 8. followup 生成失敗時の API contract（PR6 追補 / 必須）

回答（voice STT 成功 / text 保存）は成功したが、**その直後の followup 質問の生成 / 保存だけが失敗**した場合、
route は `200` + `questionError`（`question-generation-failed` | `turn-save-failed`）を返す。
このとき回答ターンは保存済み・課金トリガも確定済みで、不足しているのは「次の質問」だけである。

この状態に対する **client / API の契約** を以下に固定する。

### 8.1 client（UI）の責務

- `questionError` が存在する場合、UI は **次の質問へ自動遷移しない**。
- 「次の質問生成に失敗しました。再試行してください」を表示する。
- ユーザーの再試行操作で followup 生成をリトライする（自動リトライは任意だが、無限リトライは禁止）。

### 8.2 再試行 API

- 再試行は **`POST /api/interview-ai/turn` に `{ sessionId, retryFollowup: true }`** を送る（同一 turn endpoint の retry リクエスト）。
- 元の回答（answer / audio）は **再送しない**。再送は回答ターンの二重作成を招くため、retry 経路では受け付けない。

### 8.3 再試行の不変条件（サーバ実装が保証）

| 不変条件 | 実装 |
|---|---|
| recordUsage を **再実行しない** | `handleRetryFollowup` は `triggerInterviewAiBilling` を呼ばない。仮に呼んでも compare-and-set は既に true で勝者にならず二重課金しない（二重防御） |
| 既存 turn を重複作成しない | retry は answer ターンを insert しない。followup（question ターン）のみ `answerIndex + 1` に保存 |
| followup のみ再生成・再保存 | `genAndSaveFollowup` を answer パスと共有。retry では answer は触らない |
| 冪等 | 既に followup が保存済み（最後のターンが question）なら、その質問をそのまま返す（200、二重生成しない） |
| 上限尊重 | answer 件数が上限なら followup を生成せず `done: true`（§7） |

### 8.4 再試行レスポンス

| status | body | 意味 |
|---|---|---|
| 200 | `{ question, questionTurnIndex, done: false }` | 再生成成功（followup 保存済み） |
| 200 | `{ question: last question, questionTurnIndex, done: false }` | 既に followup あり（冪等） |
| 200 | `{ ..., done: true, question: null }` | 上限到達で followup 不要 |
| 200 | `{ ..., question: null, questionError }` | 再試行も失敗 → さらに retry 可能 |
| 409 | `{ error: 'no-pending-followup' }` | 再試行対象の回答が無い（ターン 0 件） |
| 404 / 409 | — | 所有者不一致 / status≠in_progress（§4） |

> まとめ: followup 失敗は「回答は確定・次の質問だけ未確定」という **回復可能な中間状態**であり、
> `retryFollowup` で followup だけを安全に再生成できる。再試行は冪等で、二重課金・二重 turn を起こさない。
