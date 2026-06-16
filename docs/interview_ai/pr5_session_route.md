# Interview AI — PR5 セッション作成 route（/api/interview-ai/session）

PR0 設計（[pr0_design.md](./pr0_design.md) §5.3 / §7.3）の「セッション作成時 gate + in_progress insert」を
実装した記録。PR3 schema（[pr3_schema.md](./pr3_schema.md)）+ PR4 quota の上に乗る。

実装: [app/api/interview-ai/session/route.ts](../../app/api/interview-ai/session/route.ts)。

> 本 route は **セッションを in_progress で作るだけ**。recordUsage / STT / 質問生成は呼ばない（PR6+）。
> **PR5 完了時点で監査レビュー**（課金・STT・usage_recorded・followup が絡む PR6 以降の前）。

---

## 1. 契約

```
POST /api/interview-ai/session
body: { source: 'voice' | 'text', targetRef?: object }
```

| status | body | 意味 |
|---|---|---|
| 201 | `{ session: { id, source, status, targetRef, createdAt } }` | 新規 in_progress セッション作成 |
| 200 | `{ error: 'in-progress-exists', session }` | 既存 in_progress あり → 続きから誘導（§7.3 確定: 新規作成は拒否） |
| 400 | `{ error: 'invalid-source' \| 'invalid-body' }` | source が voice/text 以外 / body 不正 / targetRef 過大 |
| 401 | `{ error: 'unauthenticated' }` | gate（未認証） |
| 402 | `{ error: 'quota-exceeded', ... }` | gate（当月 interview-ai quota 超過） |
| 500 | `{ error: 'session-create-failed' }` | insert / 既存取得失敗 |

---

## 2. 設計判断

### 2.1 gate は作成前（pr0_design.md §5.3）

`ensurePlanQuota('interview-ai')` を insert 前に判定する。quota の COUNT は当月 `status='ok'` の
`usage_records`（route=`'interview-ai'`）= **当月完了セッション数**。本 route は recordUsage を呼ばない
ので、作成中の in_progress はまだ COUNT に載らない。実計上は voice の最初の STT 成功 / text の最初の
回答保存で行う（PR6+）。

### 2.2 in_progress 重複は「続きから」（§7.3 / §3.3）

`interview_ai_sessions_one_in_progress`（status='in_progress' の user 部分 unique index）違反
（SQLSTATE 23505）を検知したら、既存の in_progress セッションを取得して 200 + `in-progress-exists` で返す。
これにより:

- ユーザーは新規ではなく**続きから**に誘導される（確定挙動）。
- gate 通過〜recordUsage 計上の窓で「セッションを多数開いて未計上のまま使い倒す」quota 回避を封じる
  （3 層防御: gate + in_progress 制約 + compare-and-set。§3.3）。

### 2.3 insert は service_role

userId は gate で認証済み。insert は server-only の service_role で行う（RLS バイパス、recordUsage と同経路）。
owner RLS policy（§58）は client 読み取り / 状態遷移用に併存する。

### 2.4 target_ref の version 補完（§6.3）

DB は jsonb の shape を強制しないが、本 route はアプリ契約として `version` を必ず入れる。
入力 targetRef が version を持たなければ `version=1` を補い、`{ version, ...targetRef }` を保存する。
暴走 payload 防止に JSON 文字列長 4000 字の上限ガードを置く。

### 2.5 usage_recorded は false 初期値

compare-and-set（`UPDATE ... SET usage_recorded=true WHERE id=:id AND usage_recorded=false RETURNING id`）
は PR6+ の課金トリガで行う。本 route は false のまま作成する。

---

## 3. 手動検証手順（要 Supabase apply + 認証）

1. `POST { source: 'text', targetRef: { universityId: 'x' } }` → 201、`session.status='in_progress'`、
   `session.targetRef.version === 1`。
2. 続けて同ユーザーで `POST { source: 'voice' }` → 200 `in-progress-exists`、§1 の session は 1 で作った id。
3. 1 のセッションを `completed` に更新後、再度 `POST` → 201（新規作成可）。
4. quota を使い切った状態（当月 ok 件数 ≥ limit）で `POST` → 402 `quota-exceeded`。
5. `POST { source: 'invalid' }` → 400 `invalid-source`。

> 自動テストは route ハーネス整備後の別 STEP。本 PR は型 / lint クリーンを確認済み。

---

## 4. 後続 PR への申し送り（監査レビュー後）

| PR | 内容 |
|---|---|
| PR6+ | `/api/interview-ai/turn`（seed / followup / turn analysis）/ STT / **recordUsage + usage_recorded compare-and-set** / final feedback 保存（interview_ai_results） |
| | seed / followup / turn analysis / final feedback は **logAiUsage のみ**（recordUsage は呼ばない。§4） |
| | 課金トリガは voice=最初の STT 成功 / text=最初の回答保存の 2 箇所のみ（§2） |
