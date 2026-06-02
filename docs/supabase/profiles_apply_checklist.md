# profiles — Post-Apply Verification Checklist

`supabase/schema.sql` §16〜§18（`profiles` テーブル + trigger + RLS）を Supabase project に apply した直後〜24h の確認項目。本 checklist は **operator が手動実行** する。dashboard は作らず Supabase SQL editor / Table Editor 上の ad-hoc 操作で完結する。

関連:
- [`phase2_auth_boundary.md`](./phase2_auth_boundary.md) — Phase2 Auth boundary 契約
- [`../../lib/supabase/profile.ts`](../../lib/supabase/profile.ts) — profiles 行アクセス helper
- [`../../app/account/page.tsx`](../../app/account/page.tsx) — display_user_id 設定 UI
- [`../../lib/displayUserId.ts`](../../lib/displayUserId.ts) — バリデーションルール

---

## 0. Pre-flight

### 0.1 前提

- Supabase project Settings → Authentication → **Anonymous Sign-Ins が ENABLED** であること
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` が production 環境に設定済み
- 既存の mirror テーブル群（`student_profile_mirrors` / `basic_info_mirrors` / `diagnosis_mirrors` / `activity_mirrors` / `mirror_events`）が apply 済みであること（profile DDL 自体は依存しないが、運用習熟度の前提）

### 0.2 Apply 手順

1. Supabase Studio → **SQL Editor** を開く
2. `supabase/schema.sql` §16〜§18 のブロックを selection コピー
   - `-- 16. profiles ...` から `WITH CHECK (auth.uid() = id);` までの **連続ブロック**
3. `RUN` を実行
4. エラーなく完了することを確認（既に同名 table がある場合は `relation "profiles" already exists` で停止する。既存環境への重複 apply は行わない）

---

## 1. Immediate verification (apply 後 30 分以内)

### 1.1 Table existence + RLS state

```sql
SELECT
  relname,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname = 'profiles';
```

期待: 1 行 / `rls_enabled = true`。

`rls_enabled = false` の場合は STOP。`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;` が反映されていない。

### 1.2 Policy count

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;
```

期待: **3 行のみ**。
- `profiles authenticated select` / `SELECT` / `{authenticated}`
- `profiles owner insert`         / `INSERT` / `{authenticated}`
- `profiles owner update`         / `UPDATE` / `{authenticated}`

**4 行目（特に DELETE / anon policy）が出てきたら STOP**。Phase2 契約違反。`DROP POLICY` で除去し原因調査。

### 1.3 Trigger presence

```sql
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgname = 'profiles_set_updated_at';
```

期待: 1 行 / `tgrelid = profiles`。`set_updated_at()` 関数は §3 で既存定義されたものを再利用。

### 1.4 Column shape

```sql
SELECT column_name, column_default, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;
```

期待:

| column_name | column_default | is_nullable | data_type |
|---|---|---|---|
| `id` | (NULL) | NO | `uuid` |
| `display_user_id` | (NULL) | YES | `text` |
| `plan` | `'free'::text` | NO | `text` |
| `created_at` | `timezone('utc'::text, now())` | NO | `timestamp with time zone` |
| `updated_at` | `timezone('utc'::text, now())` | NO | `timestamp with time zone` |

### 1.5 Constraint presence

```sql
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'profiles'::regclass
ORDER BY conname;
```

期待: 以下 3 件以上が存在すること。

- PRIMARY KEY on `id`
- FOREIGN KEY on `id` referencing `auth.users(id)` ON DELETE CASCADE
- UNIQUE on `display_user_id`

UNIQUE が無いと duplicate check の最終防衛が消える。FK が無いと `auth.users` 削除時に profile が orphan 化する。どちらも STOP 案件。

### 1.6 Table Editor 上の確認

1. Supabase Studio → **Table Editor** → `public.profiles` を開く
2. 行が 0 件であること（apply 直後 / production user の最初の AuthProvider マウントまでは 0 のはず）
3. Column 一覧が §1.4 と一致

---

## 2. End-to-end verification (anonymous user で /account を触る)

### 2.1 Anonymous user の払い出し

1. **新規シークレットウィンドウ** で本番 URL を開く（PASSAI のトップページで OK）
2. ブラウザの DevTools → Application → Storage → Cookies を開き、`sb-*-auth-token` cookie が作成されていることを確認
3. 同じく Application → Local Storage 配下に Supabase の session 情報が保存されることを確認（Supabase v2 client は localStorage と cookie 両方を使う）

確認: AuthProvider が正常にマウントされていれば、`ensureAnonymousUser()` 経由で `auth.signInAnonymously()` が走り session が確立する。

### 2.2 profiles 行の自動作成

Supabase Studio → Table Editor → `public.profiles`:

期待: §2.1 直後に 1 行追加されている。
- `id` = anonymous user の uuid
- `display_user_id` = NULL
- `plan` = `free`
- `created_at` / `updated_at` = 直近 1 分以内

**作成されていない場合**:
- ブラウザの Network タブで `*/rest/v1/profiles` への POST が走ったか確認
- Console に Supabase error が出ていないか確認（CORS / RLS 拒否）
- `auth.users` 側にも anonymous user が登録されているか確認（Studio → Authentication → Users）

### 2.3 display_user_id の保存

1. シークレットウィンドウのまま `/account` に遷移
2. "現在の表示 ID" が **「未設定」** と表示されることを確認
3. 入力欄に `boku_test_01`（任意の valid 値）を入力
4. **保存する** を押下
5. UI に「表示 ID を保存しました。」（success AlertBox）が出ることを確認
6. ページをリロードし、"現在の表示 ID" が `boku_test_01` になっていることを確認

### 2.4 重複エラー（別ブラウザで同じ ID）

1. **別のシークレットウィンドウ**（=別の anonymous user）で本番 URL を開く
2. `/account` に遷移
3. §2.3 で使った **同じ値** `boku_test_01` を入力 → 保存
4. UI に「この ID は既に他のユーザーが使用しています。」が表示されることを確認

確認ポイント:
- 事前 check (`isDisplayUserIdTaken`) が hit すれば「事前」エラーで表示される
- 事前 check を擦り抜けた場合も DB UNIQUE 制約による unique_violation を `saveDisplayUserId` が `{ kind: 'duplicate' }` に翻訳し同じメッセージを出す
- どちらの経路でも、**他人の行が読み書き不可** であることが Table Editor 側で残されている `display_user_id` の値で確認できる（他人の行が書き換わっていない）

### 2.5 バリデーションエラー（クライアント側）

`/account` で以下を順に試して、すべて **保存ボタンが押せない / エラー表示** になることを確認。

| 入力 | 期待エラー |
|---|---|
| `Boku0427` (大文字) | 文字種エラー |
| `boku-0427` (ハイフン) | 文字種エラー |
| `_boku` (先頭 `_`) | 先頭末尾は英数字エラー |
| `boku_` (末尾 `_`) | 先頭末尾は英数字エラー |
| `pa` (2 文字) | 長さエラー |
| `admin` (予約語) | 「この ID は使用できません」 |

エラーが出ない / 保存できてしまう場合は `lib/displayUserId.ts` のルール変更が反映されていない疑い。

### 2.6 SQL レベルでの整合確認

```sql
SELECT id, display_user_id, plan, created_at, updated_at
FROM profiles
ORDER BY created_at DESC
LIMIT 5;
```

§2.1〜§2.4 で作った 2 行の anonymous user 行が両方残り、`display_user_id` 列が一意であることを確認。

---

## 3. 既存機能の Regression 確認

profile 導入による既存機能の壊れがゼロであることを **目視 / クリック** ベースで確認する。Phase2 Auth は UI を一切変えない契約なので、以下は **すべて変化なし** であるはず。

### 3.1 主要ページの素の表示

シークレットウィンドウで順番に開き、コンソールエラーゼロ / レイアウト崩れなしを確認:

- `/` (ランディング)
- `/home`
- `/diagnosis`
- `/self-analysis`
- `/statement`
- `/essay`
- `/essay-practice`
- `/interview`
- `/matching`
- `/admission-matching`
- `/mypage`
- `/tutor`

### 3.2 localStorage canonical の動作

- `/input/basic` で basicInfo を保存 → 再読み込みで保持されている
- `/input/activity` で activity を 1 件保存 → 再読み込みで保持されている
- `/diagnosis` で診断を 1 回完了 → 再読み込みで結果が保持されている
- `/self-analysis/run` で 1 セッション動かす → 結果保持

これらの canonical UX が profile 導入で影響を受けないこと（profile 行作成 / 失敗を問わず動くこと）を確認。

### 3.3 mirror_events の連続性

profile 導入と同タイミングで mirror が無音化していないかを確認。

```sql
SELECT
  feature,
  mirror_status,
  count(*) AS n
FROM mirror_events
WHERE created_at >= now() - interval '24 hours'
GROUP BY feature, mirror_status
ORDER BY feature, mirror_status;
```

期待: 各 feature × success / skipped / failed の row 分布が apply 前後で大きく崩れていないこと。

---

## 4. Negative checks（やっていないこと）

Phase2 Auth は以下を **やらない** ([`phase2_auth_boundary.md §7`](./phase2_auth_boundary.md) / [`§9`](./phase2_auth_boundary.md))。本 STEP 後に grep で痕跡が無いことを確認する。

### 4.1 既存 storage の user_id 化が無い

```sh
grep -rn "user_id\|userId\|currentUserId" lib/*Storage.ts
```

期待: hit ゼロ。`lib/{feature}Storage.ts` のいずれにも user_id 紐付けが入っていない。

### 4.2 既存機能ページが useCurrentUserId を読んでいない

```sh
grep -rn "useCurrentUserId\|useProfile" app | grep -v "app/account\|app/components/AuthProvider"
```

期待: hit ゼロ。`/account` 以外の機能ページは auth state を読まない。

### 4.3 mirror 系ファイルが user_id を扱っていない

```sh
grep -rn "user_id\|auth.uid" lib/supabase/mirror*.ts
```

期待: hit ゼロ。N=4 mirror は引き続き anonymous write-only。

### 4.4 login wall / auth gate が無い

```sh
grep -rn "signInWithPassword\|signInWithOAuth\|signOut\|redirectTo" lib app components
```

期待: hit ゼロ。anonymous 以外の auth 経路を作っていない。

---

## 5. Rollback procedure

profiles 行 / 配線に問題が起きた場合の戻し方。

### 5.1 UI 側の即時停止

`/account` 経由の保存だけを止めたい場合: コード変更を伴わず、Supabase Studio で

```sql
ALTER POLICY "profiles owner update" ON profiles
USING (false)
WITH CHECK (false);
```

を一時適用。`saveDisplayUserId` は `{ kind: 'error' }` を返し、UI は保存失敗を表示する。

### 5.2 全体ロールバック

profiles の存在ごと無効化したい場合:

```sql
DROP TABLE IF EXISTS profiles CASCADE;
```

- AuthProvider の `ensureProfile()` は `null` を返し、UI は profile undefined のまま動く（`/account` は保存エラー表示で停止、それ以外の機能は影響なし）
- canonical UX は localStorage のままなので壊れない

`DROP TABLE` を実行する前に Studio の Table Editor で「他のテーブルが profiles を参照していない」ことを確認すること（Phase3 以降に FK 参照が追加されている場合は CASCADE 影響を要確認）。

### 5.3 anonymous user の払い出しを止める

incident で Anonymous Auth ごと止める場合: Supabase Studio → Authentication → Providers → **Anonymous Sign-Ins を OFF**。

- 既存の anonymous user は session を維持
- 新規 anonymous user の発行が止まる
- AuthProvider 側は `signInAnonymously` の失敗を null フォールバックで吸収するので UI は壊れない（[STEP-AUTH-01 仕様](../../lib/supabase/auth.ts)）

---

## 6. Sign-off

operator は本 checklist を上から順に通し、§1 / §2 / §3 が全て pass したことを記録する。失敗項目があれば該当する rollback path を踏んで原因を切り分け、修正後に再度 §1 から実行する。

profiles テーブルは Phase2 Auth boundary の **唯一の auth canonical** であり、ここの整合性が崩れると `/account` 以外にも将来の Stripe / Phase3 user-scoped canonical 移行が連鎖的に詰まる。`SELECT * FROM profiles LIMIT 5` で row が見える状態と、`pg_policies` で 3 policy のみが立っている状態を、apply 後 24h 以内に必ず operator が手で確認する。
