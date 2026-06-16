# Interview AI — PR9 UI（/interview/ai）

AI 面接のクライアント UI。質問表示・録音/テキスト回答・transcript 確認/編集・次へ・結果表示・
loading/エラー・in_progress 再開ダイアログを実装する。

実装:
- page: [app/interview/ai/page.tsx](../../app/interview/ai/page.tsx)
- client: [app/interview/ai/InterviewAiClient.tsx](../../app/interview/ai/InterviewAiClient.tsx)（state machine）
- API helper: [app/interview/ai/api.ts](../../app/interview/ai/api.ts)（fetch ラッパ / status マッピング）
- 再開用 read route: [app/api/interview-ai/state/route.ts](../../app/api/interview-ai/state/route.ts)
- 導線: [app/interview/page.tsx](../../app/interview/page.tsx) メニューに「AI面接を受ける」追加

> サーバ側（PR5〜7）は変更なし。本 PR は UI + 再開用 read-only state route のみ。

---

## 1. UI フロー（state machine）

```
setup ──[面接を始める]──> createSession
  ├ created ─────────> kickoff(seed質問) ─> interviewing
  ├ in-progress-exists ─> 再開ダイアログ
  ├ quota-exceeded ──> エラー表示（上限）
  └ error ───────────> エラー表示

interviewing (現在の質問に回答)
  ├ text:  textarea（確認・編集）─[次へ]─> submitTextAnswer
  ├ voice: [録音開始]→[録音停止]─> submitVoiceAnswer
  │         └ stt-error ─> STT未設定 → テキストモード誘導
  ├ 回答結果:
  │   ├ next ─────────> 次の質問へ（exchange に追記）
  │   ├ question-error ─> 再試行導線（[再試行する]→retryFollowup）
  │   └ done / limit ──> [結果を見る]
  └ [面接を中断する] ─> abandon（明示キャンセル）

[結果を見る] ─> completeSession ─> result（feedback + strengths/improvements/nextPractice）
```

各アクションは `loading` で多重送信を防ぎ、失敗は `errorMsg`（AlertBox）で表示する。

---

## 2. in_progress 再開導線（409 IN_PROGRESS_EXISTS）

- session 作成時、既存 in_progress があると route は `in-progress-exists` + 既存 session を返す（PR5）。
- UI は **再開ダイアログ**を出す:
  - 「続きから再開する」→ `GET /api/interview-ai/state?sessionId=` で現在状態を取得し復元:
    - `needsKickoff`（ターン0）→ kickoff から
    - `currentQuestion`（最後が question）→ その質問に回答
    - `needsRetry`（最後が answer / followup 未生成）→ 再試行導線
    - `done`（回答上限）→ [結果を見る]
  - 「この面接を中断して新しく始める」→ `abandon`（明示キャンセル）→ setup へ
- `state` route は read-only（recordUsage を呼ばない）。owner / in_progress を guard。

---

## 3. questionError 再試行導線

- followup 生成/保存失敗時、turn route は `200 + questionError`（PR6 §8 contract）を返す。
- UI は次質問へ**自動遷移せず**、「次の質問の生成に失敗しました。再試行してください」+ [再試行する] を表示。
- [再試行する] → `POST /turn { retryFollowup: true }`（回答は再送しない / 二重課金しない / PR6 §8）。
  - `next` → 次の質問を表示。`done` → [結果を見る]。再び失敗 → 再試行を促す。

---

## 4. STT 未設定時の挙動

- voice セッションで録音送信 → STT 未設定なら turn route が `502 stt-unavailable`。
- UI は `stt-error` を受け、**テキストモード誘導**:
  - 「音声認識が未設定です。テキストモードで面接を始め直してください」を表示。
  - 当該 voice セッション内ではテキスト回答に切替えない（session.source 権威 / PR6 で voice→text 同一セッション切替は対象外）。ユーザーは中断 → テキストで開始し直す。
- setup の voice 選択時にも「未設定の環境では利用不可」を事前注意表示。
- 録音不可環境（`navigator.mediaDevices` なし / 権限拒否）も同様にテキスト誘導。

> text モードは STT に依存せず完全動作するため、MVP の主経路はテキスト。

---

## 5. transcript 確認 / 編集（仕様差分の明文化 / 必須）

### 5.1 当初仕様 vs MVP 実装の差分

当初の想定フローは:

```
音声回答 → 文字起こし → ユーザー修正 → AI分析
```

だったが、**PR9 の MVP 実装では「保存前の transcript 確認/編集ステップ」を持たない**。
理由は、voice 回答が **STT 成功時点でサーバ保存・課金される**（PR6 turn route）ためである。
STT → 課金トリガ → transcript 保存 → followup が 1 リクエストで完結するので、保存より前に
ユーザーが transcript を編集する余地が無い。

### 5.2 MVP での確定仕様

| 項目 | MVP の挙動 |
|---|---|
| voice mode | STT 成功後、その transcript を **そのまま保存・分析**する（保存前編集なし） |
| voice mode | 保存前編集は **MVP では実装しない** |
| text mode | textarea により **送信前編集が可能** |
| STT 誤りが気になるユーザー | **text mode を使う**（text は STT 非依存で完全動作） |
| voice transcript 確認/編集 | **将来 PR で検討**（5.3 の複雑性を解消する設計とセットで） |

### 5.3 この差分を選んだ理由

- voice の保存前編集を入れると、**課金トリガ（STT 成功時）・turn 保存・再開状態**の整合が複雑化する
  （「STT 済みだが未保存・未課金」という中間状態を turn / usage_recorded / state route の全てで扱う必要が出る）。
- MVP では **課金と状態管理の安全性を優先**し、voice は「STT 成功＝保存＝課金」の単純不変条件を維持する。
- 編集が必要なユーザーには text mode を案内する（UI でも STT 未設定時にテキスト誘導）。

> まとめ: MVP の voice は「文字起こし＝確定保存」。確認/編集が要るなら text mode。
> voice の保存前編集は、課金トリガ・turn 保存・再開状態を再設計する将来 PR の課題とする。

---

## 6. abandoned（明示キャンセル）

- 「面接を中断する」/ 再開ダイアログの「中断して新しく始める」→ `confirm` → `POST /abandon`。
- 成功で status='abandoned'（PR7）→ setup へ戻し「面接を中断しました」を表示。
- abandoned セッションは履歴非表示（PR8 §4）。

---

## 7. loading / エラーハンドリング

- すべての非同期アクションは `loading` ガード（ボタン disabled / 「処理中…」表示）。
- API helper（api.ts）が HTTP status / body を discriminated union に正規化:
  `created / in-progress-exists / quota-exceeded / unauthenticated / next / question-error / done / stt-error / limit / completed / feedback-error / abandoned / error`。
- ネットワーク/JSON 失敗も握って `error` に倒し、UI は AlertBox で通知（never silent）。

---

## 8. 監査報告（PR9 完了時）

| 項目 | 内容 |
|---|---|
| UI フロー | setup → (createSession) → kickoff → interviewing（質問/回答/次へ）→ done → complete → result。§1 |
| in_progress 再開導線 | 409 in-progress-exists → 再開ダイアログ → `GET /state` で復元（kickoff/question/retry/done 分岐）。§2 |
| questionError 再試行導線 | 自動遷移せず [再試行する] → retryFollowup。二重課金なし（PR6 §8）。§3 |
| STT 未設定時の挙動 | 502 stt-unavailable → テキストモード誘導。setup で事前注意。text は STT 非依存で動作。§4 |
| tsc / eslint | exit 0 / exit 0 |

---

## 9. 後続（PR10+ 想定）

- voice STT 実プロバイダ接続（lib/interviewAi/stt.ts の境界を埋める）。
- 結果（results）の再閲覧用 GET endpoint + 履歴カードからの詳細表示。
- voice セッション内の text fallback（同一セッションでの切替）を許容するかの設計判断（PR6 課金トリガと整合させる必要あり）。
