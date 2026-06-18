# プレゼン機能 設計正本（PR0 / Design）

> 本ドキュメントはプレゼン機能の **Single Source of Truth（正本）** である。
> 以降の STEP 実装（DB マイグレーション → API → フロント）は本書の確定事項に従う。
> 設計レビュー（実装前 8 観点）を通過し、判定は **GO（条件付き）**。必須3件＋強く推奨は本書本文に織り込み済み。
>
> 関連: 面接AI設計 [`../interview_ai/pr0_design.md`](../interview_ai/pr0_design.md) / スコア契約 [`../principles/ai_score_contract.md`](../principles/ai_score_contract.md) / 課金ゲート [`lib/billing/planGate.ts`](../../lib/billing/planGate.ts)

---

## 1. 機能概要

プレゼン機能は、総合型選抜・学校推薦型選抜のプレゼン試験対策のための **Premium 限定機能**。
面接AI（[`lib/interviewAi/`](../../lib/interviewAi/)）の設計思想をそのまま踏襲し、差分を「動画の永続保存（Supabase Storage）」のみに抑える。

再現するフロー:

```
録画 → 動画を Storage 保存 → 文字起こし → AI評価 → 発表後AI質問（ターン制） → 履歴保存
```

面接AIから継承する思想:

- リアルタイム音声会話は採用しない（プレゼン本番もリアルタイムではない）
- AIは発表中に口を挟まない
- ターン制でAIが質問する
- 1セッション = 1カウント
- 履歴は Supabase で管理する
- AI評価はカテゴリ評価（`weak` / `normal` / `strong`）。数値評価はしない
- compare-and-set で二重課金を防止する

面接AIからの **意図的な逸脱**:

- 面接AIは音声を保存しない。プレゼンは **動画を永続保存する**（見返し・本番に近い緊張感・対人活用・AI評価の補助データ）。
  音声非保存原則の緩和であり、プライバシー対応（§9）を必須とする。

機能モードは 2 つ:

1. **AIプレゼン練習** — 録画 → 文字起こし → AI評価 → 発表後AI質問
2. **対人プレゼンモード** — 友達・先生・親との発表を手動記録（AI不使用・課金なし・録画なし）

---

## 2. MVP スコープ

8月までに実装できる軽量・堅牢・保守しやすい範囲に限定する。面接AIから大きく逸脱しない。

含むもの:

- テーマ設定（志望校 / 学部学科 / プレゼンテーマ / 制限時間 / 発表原稿（任意））
- ブラウザでのカメラ録画（デスクトップ Chrome 優先）
- 動画の Supabase Storage 保存（private bucket + signed URL）
- 文字起こし（Whisper / クライアント保持の音声 blob を送信）
- AI カテゴリ評価（6 軸 weak/normal/strong）
- 発表後AI質問（ターン制 Q&A、面接AIロジック流用）
- 履歴保存・一覧（AI練習＋対人記録）
- 対人プレゼン記録（手動）
- Premium 限定課金（1セッション=1消費、初回評価成功時のみ）
- 録り直し上限 3 回（サーバ強制）

新規構築（面接AIに無い）= スケジュールリスク集中点:

1. Supabase Storage（プロジェクト初導入）
2. カメラ録画 UI
3. 動画とは別の音声 blob 取得（サーバ ffmpeg を使わないため）

---

## 3. やらないこと（MVP 対象外）

禁止事項（明示）:

- リアルタイムAI
- AIアバター
- 表情解析 / 目線解析 / 姿勢解析 / ジェスチャー解析 / カメラ目線率分析
- ライブ採点
- WebRTC
- 常時接続機能

MVP では扱わないが将来余地として残課題化:

- 動画解析全般（MVP は文字起こし＋メタデータのみで評価）
- サーバ側 ffmpeg 等のメディア処理（クライアントで音声を別取りして回避）
- 動画の自動失効 / cron 削除（手動削除のみ実装。TTL は残課題）
- 再エンコード / 字幕焼き込み / サムネ生成
- TTS（質問読み上げ）。[`lib/interviewAi/tts.ts`](../../lib/interviewAi/tts.ts) で後付け可能だが MVP 外
- attempt の再評価上書き（再評価は新 attempt 運用）
- Safari など Chrome 以外の完全対応（mimeType ランタイム判定で許容範囲のみ）
- STT の共通ライブラリ化（MVP は面接AIの関数を直接 import。抽象化は後回し）

---

## 4. DB 設計（Supabase）

### 4.1 テーブル構成と責務

```
presentation_sessions        … テーマ設定 ＋ 課金単位（usage_recorded をここに置く）
  └─ presentation_attempts    … 1録画 = 1動画 + 1文字起こし（録り直しで複数行）
       ├─ presentation_results   … attempt への AIカテゴリ評価（1:1）
       └─ presentation_qa_turns  … 発表後AI質問のターン（interview_ai_turns 同型）
presentation_practice_records … 対人モード（AI不使用・課金なし・録画なし）
```

### 4.2 `presentation_sessions`（★課金単位）

| column | type | 備考 |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| user_id | uuid NOT NULL | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| status | text NOT NULL DEFAULT `'in_progress'` | `CHECK IN ('in_progress','completed','abandoned')` |
| university_name | text NOT NULL DEFAULT `''` | 志望校 |
| faculty_name | text NOT NULL DEFAULT `''` | 学部学科 |
| theme | text NOT NULL DEFAULT `''` | プレゼンテーマ |
| time_limit_sec | integer NOT NULL DEFAULT `0` | 制限時間 |
| script | text NOT NULL DEFAULT `''` | 発表原稿（任意） |
| usage_recorded | boolean NOT NULL DEFAULT `false` | ★1セッション1課金の compare-and-set フラグ |
| created_at / updated_at | timestamptz | `set_updated_at()` トリガ |
| metadata | jsonb NOT NULL DEFAULT `'{}'` | 将来拡張余地 |

- 一意制約: `CREATE UNIQUE INDEX presentation_sessions_one_in_progress ON presentation_sessions(user_id) WHERE status='in_progress';`
  （面接AI `interview_ai_sessions_one_in_progress` と同型。同時多重セッション防止）
- index: `(user_id, created_at DESC)`（履歴一覧）
- 状態遷移: `in_progress` → `completed`（評価・Q&A完了） / `abandoned`（離脱）

### 4.3 `presentation_attempts`

| column | type | 備考 |
|---|---|---|
| id | uuid PK | クライアントが `crypto.randomUUID()` で**先に採番**（Storage パス確定のため） |
| session_id | uuid NOT NULL | `REFERENCES presentation_sessions(id) ON DELETE CASCADE` |
| user_id | uuid NOT NULL | RLS 用に非正規化 |
| attempt_index | integer NOT NULL DEFAULT `1` | 録り直し番号（1〜3） |
| storage_path | text NOT NULL DEFAULT `''` | 動画オブジェクトキー（**サーバが正準生成**、§5.2 / §12） |
| transcript | text NOT NULL DEFAULT `''` | 文字起こしテキストのみ |
| duration_sec | integer NOT NULL DEFAULT `0` | 実測発表時間（時間配分評価の入力） |
| status | text NOT NULL DEFAULT `'uploaded'` | `CHECK IN ('uploaded','transcribed','evaluated','failed')` |
| created_at / updated_at | timestamptz | |

- 一意制約: `UNIQUE(session_id, attempt_index)`
- 課金フラグは attempt に置かない（録り直しで追加消費しないため session に集約）
- 状態遷移: `uploaded`（動画保存済）→ `transcribed`（STT済）→ `evaluated`（評価済） / `failed`
- index: `(session_id, attempt_index)`
- 録り直し上限: `attempt_index <= 3`。**サーバ `attempt` route で count して 4 本目以降は 409**（§6 / §8）

### 4.4 `presentation_results`

| column | type | 備考 |
|---|---|---|
| id | uuid PK | |
| attempt_id | uuid NOT NULL UNIQUE | `REFERENCES presentation_attempts(id) ON DELETE CASCADE` |
| user_id | uuid NOT NULL | RLS 用 |
| feedback | jsonb NOT NULL | `PresentationFeedback` 全文（§10.2） |
| categories | jsonb NOT NULL DEFAULT `'{}'` | `{composition:'strong',...}` 投影（履歴一覧の高速表示用） |
| created_at | timestamptz | |

- 一意制約: `UNIQUE(attempt_id)`（1 attempt = 1 評価。二重 INSERT 防止。再評価は新 attempt）
- **セッション代表 result**: 「`attempt_index` が最大の evaluated attempt」を代表とする（履歴クエリ規約。`final_attempt_id` 列は追加しない）

### 4.5 `presentation_qa_turns`（[`interview_ai_turns`] 同型）

| column | type | 備考 |
|---|---|---|
| id | uuid PK | |
| attempt_id | uuid NOT NULL | `REFERENCES presentation_attempts(id) ON DELETE CASCADE` |
| user_id | uuid NOT NULL | RLS 用 |
| turn_index | integer NOT NULL | 0=AI質問, 1=回答, 2=深掘り... |
| role | text NOT NULL | `CHECK IN ('question','answer')` |
| source | text NOT NULL | `CHECK IN ('voice','text')` |
| content | text NOT NULL | transcript のみ（音声なし） |
| created_at | timestamptz | |

- 一意制約: `UNIQUE(attempt_id, turn_index)`
- Q&A は「評価済みの代表 attempt」に紐づく

### 4.6 `presentation_practice_records`（対人・AI不使用）

| column | type | 備考 |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NOT NULL | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| local_record_id | text NOT NULL | localStorage ミラー用自然キー（面接と同方式） |
| practice_date | text NOT NULL DEFAULT `''` | |
| university_name / faculty_name / theme | text NOT NULL DEFAULT `''` | |
| time_limit_sec | integer NOT NULL DEFAULT `0` | |
| partner | text NOT NULL DEFAULT `''` | 友達 / 先生 / 親 |
| composition | text NOT NULL DEFAULT `''` | 構成力 |
| persuasion | text NOT NULL DEFAULT `''` | 説得力 |
| concreteness | text NOT NULL DEFAULT `''` | 具体性 |
| delivery | text NOT NULL DEFAULT `''` | 話し方 |
| qa_note | text NOT NULL DEFAULT `''` | 質疑応答 |
| good_points | text NOT NULL DEFAULT `''` | 良かった点 |
| improvements | text NOT NULL DEFAULT `''` | 改善点 |
| next_task | text NOT NULL DEFAULT `''` | 次回の課題 |
| created_at / updated_at | timestamptz | |
| metadata | jsonb NOT NULL DEFAULT `'{}'` | |

- 一意制約: `UNIQUE(user_id, local_record_id)`（upsert）
- 評価項目は全て自由記述（数値化しない）。[`interview_practice_records`](../../lib/supabase/interviewPracticeRecords.ts) の localStorage ミラー方式を踏襲

### 4.7 冪等性まとめ

| 対象 | 仕組み |
|---|---|
| 課金 | `presentation_sessions.usage_recorded` false→true の compare-and-set 勝者のみ `recordUsage`（[`lib/interviewAi/billing.ts`](../../lib/interviewAi/billing.ts) 同手法） |
| 評価 | `presentation_results` の `UNIQUE(attempt_id)` |
| Q&Aターン | `UNIQUE(attempt_id, turn_index)` |
| アップロード登録 | `UNIQUE(session_id, attempt_index)` ＋ Storage `upsert:false` |

---

## 5. Supabase Storage 設計

> プロジェクト初の Storage 利用。private bucket + signed URL で本人限定。

### 5.1 構成

- bucket: `presentation-recordings`（**private** = public=false）
- オブジェクトキー: `{user_id}/{session_id}/{attempt_id}.{ext}`
  - 第1階層を `user_id` にすることが RLS の肝（`storage.foldername(name)[1]` で所有者判定）
  - `{ext}` は録画 mimeType に追従（`webm` / `mp4` 等。§12）

### 5.2 正準パス生成（要対応A 反映）

- `storage_path` は **クライアント送信値を一切信用しない**。
- サーバ `attempt` route が `(userId, sessionId, attemptId, ext)` から**正準パスを再構成**して DB 保存する。
- RLS の `foldername[1]=auth.uid()` と二重防御。クライアントが任意パスを渡しても別 session への付け替えを防ぐ。
- `attempt_id` はクライアントが先に採番（upload 前にパス確定が必要なため）。upload 完了後に同 ID で `attempt` を登録する。

### 5.3 アクセス制御（`storage.objects` RLS）

```sql
CREATE POLICY "own presentation recordings"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'presentation-recordings'
       AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'presentation-recordings'
       AND (storage.foldername(name))[1] = auth.uid()::text);
```

- アップロード: クライアントの user-scoped client で直接 `upload`（RLS で本人 prefix のみ許可）。サーバ帯域・タイムアウトを使わない。`upsert:false`。
- 再生: 視聴時に `createSignedUrl(path, 600)`（**10分有効**）を発行。bucket は private なので公開されない。client 自己発行可（専用サーバルートは任意）。

### 5.4 削除戦略（要対応B 反映）

> DB の `ON DELETE CASCADE` は **Storage object を削除しない**。削除は明示呼び出しが必須。

1. **ユーザー削除**: 履歴から削除 → サーバ route で `storage.remove([path])` → DB 行削除（子は CASCADE）。
2. **退会時**: `auth.users` 削除で DB は CASCADE。Storage は別管理のため、退会フックで `{user_id}/` プレフィックス一括 `remove` を行う。
3. **未成年の顔・音声を含む動画を孤児ファイルとして残さない**ことを必須要件とする。
4. **孤児ファイル**（upload 成功 → `attempt` 登録前にクラッシュ）: MVP は許容。`attempt` 登録を upload 直後に必ず呼ぶフローで最小化。将来の掃除タスクを残課題化。

### 5.5 保存期間

- MVP は明示 TTL を設けず保持（見返し用途）。容量肥大は Premium 限定＋録り直し上限 3＋月次上限で自然に抑制。
- 自動失効（cron/Edge Function）は MVP 対象外（§3）。

---

## 6. API 設計

すべて `app/api/presentation/` 配下。面接AIのルート構成に対応。

| Route | 責務 | 課金 | 冪等 / エラー |
|---|---|---|---|
| `session` POST | `ensurePlanQuota('presentation')` で Premium＋残枠判定 → in_progress 作成 | ゲートのみ・消費なし | basic/free は 402。in_progress 重複時は既存返却（200）。Premium 残枠0も402 |
| `attempt` POST | upload 完了後に呼ぶ。`storage_path`（**サーバ正準生成**）/`duration_sec` を記録（status='uploaded'）。**録り直し上限3をサーバ強制** | なし | session 所有・status='in_progress' 検証。`attempt_index>3` は **409**。`UNIQUE(session_id,attempt_index)` で再送無害 |
| `transcribe` POST (multipart) | クライアント保持の**音声blob**を受け STT（Whisper, [`stt.ts`](../../lib/interviewAi/stt.ts) 流用）→ transcript 保存・status='transcribed'。**Storage 動画は読まない / サーバ ffmpeg 不使用** | なし | STT失敗→status='failed'・transcript空・課金なし・再試行可 |
| `evaluate` POST | **`ensurePlanQuota('presentation')` を再実行**（要対応C）→ transcript＋時間＋テーマ＋志望校＋学部学科＋原稿で AI カテゴリ評価 → `results` 保存・attempt='evaluated' → **session.usage_recorded compare-and-set 勝者のみ recordUsage** | **★1消費（初回のみ）** | AI失敗→記録せず再試行可（status='ok' のみ quota 計上）。2回目以降/録り直しは `billed:false` |
| `qa` POST | ターン制質疑応答（kickoff / answer(text|voice) / followup）。[`turn/route.ts`](../../app/api/interview-ai/turn/route.ts) ロジック流用。`qa_turns` 保存 | なし（評価で課金済） | `UNIQUE(attempt_id,turn_index)` で冪等 |
| `complete` POST | session を 'completed' に | なし | 多重呼び出し無害（冪等 UPDATE） |
| `abandon` POST | session を 'abandoned' に | なし | 同上 |
| `practice-record` POST | 対人記録 upsert（localStorage ミラー） | なし | `UNIQUE(user_id,local_record_id)` で upsert |
| `attempt/[id]/signed-url` GET（任意） | 再生用 signed URL 発行。client 自己発行でも可 | なし | RLS で本人のみ |

- 履歴取得は専用 API を作らず、クライアントから user-scoped Supabase 直読み（RLS 保護）。面接AIと同方針。

---

## 7. フロント設計

| 画面 | 構成 / UIフロー | 再利用 |
|---|---|---|
| `/presentation` | ランディング。「AIプレゼン練習」「対人記録」「履歴」入口。Premium バッジ＋basic 向けアップグレード導線 | 既存プラン導線 |
| `/presentation/setup` | テーマ設定フォーム（志望校/学部学科/テーマ/制限時間/原稿任意）→ `POST /session` | 既存フォーム部品 |
| `/presentation/record` | カメラプレビュー＋制限時間カウントダウン。録画停止 → Storage upload → `POST /attempt` → `POST /transcribe`（音声blob）→ `POST /evaluate`。**録り直しボタン（残回数表示、上限3）** | 新規（録画は新規実装） |
| `/presentation/result` | 6軸カテゴリ評価バッジ（weak/normal/strong）＋講評＋**録画再生（signed URL）**＋下部に**ターン制Q&A UI** | Q&A は [`InterviewAiClient`](../../app/interview/ai/InterviewAiClient.tsx) のターンUIを流用 |
| `/presentation/history` | AI練習＋対人記録の一覧（RLS 直読み）。各カードから result/録画へ | 面接 [`history`](../../app/interview/history/) カードUI流用 |
| `/presentation/practice` | 対人記録フォーム（録画なし・手動入力）→ `POST /practice-record` | 面接 record フォーム流用 |

- 録画は二重取得: 映像付き `MediaRecorder`（→Storage）と、audio track のみの音声 `MediaRecorder`（→`transcribe`）を並行。
- mimeType は `MediaRecorder.isTypeSupported()` でランタイム判定（§12）。

---

## 8. 課金設計

Premium 限定。Basic 利用不可。

[`lib/billing/quotas.ts`](../../lib/billing/quotas.ts) に feature を 1 つ追加するだけ:

```
QUOTA_FEATURES = [..., 'presentation']
QUOTAS = {
  free:    { ..., presentation: 0 },
  basic:   { ..., presentation: 0 },   // ★Basic不可（entry で 402）
  premium: { ..., presentation: 20 },  // 月20回（暫定。動画Storage原価込みで要調整）
}
FEATURE_ROUTE_KEYS = { ..., presentation: ['presentation'] }
```

課金ルール:

- 1セッション = 1消費
- セッション開始時は消費しない
- **初回 AI評価成功時のみ消費**（`evaluate` で `recordUsage({route:'presentation', status:'ok'})`）
- 同一セッション内の録り直しは追加消費しない（`usage_recorded` を session に置く）
- compare-and-set で二重課金防止

強制ポイント:

- **Premium 限定の強制**: `basic:0` により `ensurePlanQuota('presentation')` が session 作成時点で basic/free を 402 reject。専用プラン判定の追加実装は不要。
- **要対応C**: 課金される `evaluate` でも `ensurePlanQuota('presentation')` を再実行（ダウングレード抜け道を塞ぐ）。
- **録り直し上限 3**: Storage 原価の歯止め。サーバ `attempt` route で count して 409。
- 料金ページ [`PricingSection.tsx`](../../app/components/landing/PricingSection.tsx) の表記も同時更新。

---

## 9. RLS / セキュリティ設計

### 9.1 RLS

- 親（`presentation_sessions` / `presentation_practice_records`）: owner ポリシー `auth.uid() = user_id` を CRUD 全てに付与。
- 子（`attempts` / `results` / `qa_turns`）: `user_id` 非正規化で owner **SELECT** のみ許可。INSERT/UPDATE は **service_role**（サーバ route）限定 → 課金・評価・文字起こしの改ざん防止。`results`/`qa_turns` は親 attempt の EXISTS で結合整合性を担保。
- 全テーブルに共通 `set_updated_at()` トリガ。
- Storage: §5.3 の `storage.objects` RLS（`foldername[1]=uid`）。

### 9.2 セキュリティ要点

- 要対応A: `storage_path` はサーバ正準生成。クライアント文字列を信用しない。
- 要対応B: 削除は Storage object を明示 `remove`。孤児動画を残さない。
- 要対応C: 課金アクション（`evaluate`）を必ずゲート。
- signed URL は短 TTL（10分）。

### 9.3 プライバシー対応（必須）

プレゼン機能は面接AIと違い**動画（受験生＝未成年含む の顔・音声）を永続保存**する。正本として以下を明記し、実装スコープに含める:

- 動画は**本人のみ閲覧可能**
- **private bucket**
- **signed URL で再生**（公開URLにしない）
- **本人が削除可能**
- **退会時に Storage からも削除**（§5.4）
- **プライバシーポリシー / 同意表記の更新が必要**

---

## 10. 面接AIとの共通化

### 10.1 流用マップ

| 領域 | 流用元 | 流用度 |
|---|---|---|
| usage管理 / quota | [`planGate.ts`](../../lib/billing/planGate.ts), [`quotas.ts`](../../lib/billing/quotas.ts), [`usageLog.ts`](../../lib/billing/usageLog.ts) | feature 1行追加のみ・コード変更ゼロ |
| compare-and-set 課金 | [`lib/interviewAi/billing.ts`](../../lib/interviewAi/billing.ts) | 同型コピー（計上点を evaluate に） |
| STT | [`lib/interviewAi/stt.ts`](../../lib/interviewAi/stt.ts)（Whisper/ja/音声非保存） | ほぼそのまま直接 import（共通ライブラリ化は後回し） |
| ターン制 Q&A | [`turn/route.ts`](../../app/api/interview-ai/turn/route.ts), [`questionGen.ts`](../../lib/interviewAi/questionGen.ts) | kickoff/answer/followup を transcript＋テーマ文脈に差替え |
| 履歴UI / Q&A UI | [`InterviewAiClient`](../../app/interview/ai/InterviewAiClient.tsx), [`InterviewHistoryClient`](../../app/interview/history/) | コンポーネント共有化 |
| Supabase 設計思想 | one-in-progress 部分unique / EXISTS RLS / set_updated_at / localStorage ミラー | スキーマ規約踏襲 |
| 評価 contract | [`ai_score_contract.md`](../principles/ai_score_contract.md) | カテゴリ評価＝数値矛盾なし。cache guard は type guard のみ。UI は server normalize 経由 |
| 観測 | `logAiUsage` | `presentation/evaluate`, `presentation/qa:kickoff` 等で同方式 |

### 10.2 AI評価 JSON contract（`PresentationFeedback`）

```
{
  categories: {                 // weak | normal | strong の3値のみ
    composition,                // 構成力
    persuasion,                 // 説得力
    concreteness,               // 具体性
    clarity,                    // わかりやすさ
    timeManagement,             // 時間配分（duration_sec vs time_limit_sec を入力に渡す）
    completeness,               // 発表の完成度
  },
  overallComment: string,
  goodPoints: string[],
  improvements: string[],
  nextPractice: string[],
}
```

- 数値化しないため score 整合性事故（[`ai_score_contract.md`](../principles/ai_score_contract.md) の過去事故）は構造的に発生しない。
- 評価入力: 音声文字起こし / 発表時間（duration_sec）/ プレゼンテーマ / 志望校 / 学部学科 / 発表原稿（任意）。
- `timeManagement` のみ `duration_sec` と `time_limit_sec` の差をプロンプトに渡し AI に判定させる（唯一の客観入力）。
- 発表後AI質問は面接AIのターン制（kickoff/answer/followup）を transcript＋テーマ文脈に差し替えて流用。

---

## 11. 失敗時・再試行時の挙動

| 局面 | 挙動 |
|---|---|
| 録画失敗 / 権限拒否 | 録画開始不可をUI表示。session は in_progress のまま（後で abandon 可） |
| upload 失敗 | `attempt` 登録しない。再 upload 可。孤児ファイルは残さない方針 |
| `attempt` で録り直し上限超過 | **409**。UI は「録り直しは3回まで」を表示 |
| 音声blob 喪失（リロード等） | **サーバ ffmpeg は使わない**ため再文字起こし不能。次のいずれか: ①録り直し ②原稿フォールバック ③エラー表示 |
| STT 失敗 | attempt status='failed'・transcript 空・**課金なし**・再試行可 |
| AI評価失敗 | `results` 記録せず・`recordUsage` 呼ばず（status='ok' のみ計上）・**消費なし**・再試行可 |
| evaluate 二重送信 | `usage_recorded` compare-and-set で2回目は `billed:false`。`results` は `UNIQUE(attempt_id)` で重複INSERT不可 |
| ダウングレード後の evaluate | `ensurePlanQuota` 再実行で 402（要対応C） |
| Q&A ターン重複 | `UNIQUE(attempt_id,turn_index)` で冪等 |
| complete / abandon 多重 | 冪等 UPDATE で無害 |

- **文字起こしは録画直後の同一クライアントセッションで連続実行する**仕様（音声blob はクライアント保持）。

---

## 12. 実装時の注意点

- **要対応A**: `storage_path` はサーバが `(userId, sessionId, attemptId, ext)` から正準生成。クライアント文字列を DB にそのまま保存しない。
- **要対応B**: 履歴削除・退会で Storage object を明示 `remove`（CASCADE は効かない）。
- **要対応C**: `evaluate` でも `ensurePlanQuota('presentation')` を実行。
- **録り直し上限3**: クライアント表示だけでなく `attempt` route で count して 409 を返す（サーバ強制）。
- **音声取り出し**: サーバ ffmpeg 不採用。録画時に映像付き `MediaRecorder`（→Storage）と audio track のみの音声 `MediaRecorder`（→`transcribe`）を並行。音声 opus は長尺でも数MB のため Whisper 25MB 制限は実質非問題（巨大なのは動画で、それは Whisper に送らない）。
- **mimeType ランタイム判定**: `MediaRecorder.isTypeSupported()` で `webm`/`mp4` を出し分け、Storage 拡張子もそれに追従。MVP はデスクトップ Chrome 優先。Safari 等の完全対応は目指さない。
- **発表時間上限**: UI に上限（例 5 分）を設け、Storage 容量と STT コストを抑える。
- **代表 result**: 「`attempt_index` 最大の evaluated attempt」を履歴・Q&A の対象とする（クエリ規約）。
- STT は面接AIの関数を直接 import。共通ライブラリ化（`lib/ai/stt.ts` 昇格）は MVP では行わない。
- 料金ページと quotas.ts は同時更新（quotas.ts のコメント規約）。

### DB 適用順メモ（本番 Supabase）

`presentation_attempts.metadata` 列を attempt route（PR3）で後追い追加したため、適用状態で分岐する:

- **`supabase/presentation_apply.sql` をまだ適用していない場合** → 最新の `presentation_apply.sql` をそのまま適用すれば `metadata` 列込みで作成される（schema.sql §66 が正本）。
- **旧版 `presentation_apply.sql`（metadata 列なし）を適用済みの場合** → `supabase/presentation_attempts_metadata_migration.sql`（`ADD COLUMN IF NOT EXISTS metadata`・冪等）を追加で実行する。

正本は `supabase/schema.sql`。apply 系ファイルはその逐語スライス / 追従。

---

## 13. GO 判定

**判定: GO（条件付き）**

設計は技術的に成立しており、面接AI思想からの逸脱もない。アーキテクチャ変更は不要。
必須3件（要対応 A / B / C）＋強く推奨（録り直し上限3・文字起こし仕様・録画対応範囲・プライバシー）を本書本文に織り込み済み。

次ステップ: 本書を正本として固定し、**DB マイグレーションから実装に着手**する。

実装着手順（想定）:

1. DB マイグレーション（5 テーブル + RLS + index + トリガ）
2. Storage bucket + storage.objects RLS
3. 課金 feature 追加（quotas.ts / FEATURE_ROUTE_KEYS）＋ billing 流用
4. API（session → attempt → transcribe → evaluate → qa → complete/abandon → practice-record）
5. フロント（setup → record → result → history → practice）
6. プライバシーポリシー / 同意表記の更新
