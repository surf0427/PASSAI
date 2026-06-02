# Phase2 Auth Boundary

PASSAI の Supabase 統合における **Phase2 Auth boundary 契約**。STEP-AUTH-01 (Anonymous Auth 基盤) / STEP-AUTH-02 (profiles 行 + display_user_id) で導入された auth 層の **責務と禁止事項** を、既存の Phase1 mirror boundary と矛盾しない形で固定する。

関連:
- [`phase1_boundary_freeze.md`](./phase1_boundary_freeze.md) — Phase1 mirror boundary 凍結契約（N=4）
- [`phase1_runtime_strategy.md`](./phase1_runtime_strategy.md) — Phase1 runtime 不変条件
- [`client_boundary.md`](./client_boundary.md) — Supabase client 配置ルール
- [`migration_phases.md`](./migration_phases.md) — Phase 全体の段階定義
- [`profiles_apply_checklist.md`](./profiles_apply_checklist.md) — profiles DDL apply 後の operator 手順
- [`../../lib/supabase/README.md`](../../lib/supabase/README.md) — boundary 実装の入り口

---

## 1. Purpose

Phase1 boundary は **「mirror が動いても動かなくても canonical UX が壊れない」** という invariant を最重要に据え、auth 統合を明示的に **非ゴール** ([phase1_boundary_freeze.md §4](./phase1_boundary_freeze.md), [§8](./phase1_boundary_freeze.md)) としていた。Phase2 では将来の「課金 / マイページ / 端末間移行」を見据えて user identity の足場だけを先行導入する。

本ドキュメントの役割は以下:

- Phase2 Auth で **何を許したか** と **何を許さないか** を一覧化する
- Phase1 mirror boundary の N=4 凍結を **そのまま維持** することを宣言する
- auth.users.id（内部 owner key）と display_user_id（表示専用）の **役割分離** を契約として固定する
- profiles テーブルの拡張可否（PII を入れない方針 / 拡張時の代替案）を事前に決めておく

実装着手のスイッチではなく **gate**。新規 auth 拡張は本ドキュメント PR の更新を経てから着手する。

---

## 2. Why Phase2 Now

### 2.1 Phase1 では auth を入れなかった理由（再確認）

[phase1_boundary_freeze.md §4 Explicit Non-Goals](./phase1_boundary_freeze.md) と整合した restraint:

- mirror が best-effort であることを担保するため、auth coupling を避けた
- canonical localStorage のみで完結する UX を保つため、login / session 依存を作らなかった
- mirror の rollback 単位を「revert 1 commit」に保つため、auth migration を mixed-in しなかった

### 2.2 Phase2 で auth を導入した理由

以下の運用ニーズが現実化したため、auth identity の足場のみ先行導入する。

- **マイページの "あなた" を一意に識別する手段が必要**: 現状 mypage は localStorage を読むだけで「誰の」概念が無い。将来的に複数端末 / 機種変更で履歴を引き継ぐ要望が出ているため、内部 owner key (auth.uid()) の発行経路を先に作る。
- **Stripe 連携の owner key 受け皿**: 課金導入時に必要な「請求対象の uuid」を auth.users.id に固定する。後から user 識別子を発明するより、Supabase Auth の uuid を最初から使う方が rollback が楽。
- **profiles を介した将来の plan 列拡張**: free / paid 切り替えを記録する場所を、業務テーブルからは独立した位置に確保しておきたい。
- **localStorage との 1:1 紐付けは保留**: 既存の `lib/*Storage.ts` を user_id 化する大改修は本 Phase に **含めない**（localStorage canonical は維持）。auth は **identity の発行と表示** のみ。

### 2.3 Anonymous Auth を採用した理由

Supabase Anonymous Auth（`auth.signInAnonymously()`）を採用した動機:

- **「ChatGPT のように開く → すぐ使える」UX を守る**: 既存ユーザーは login 画面を見ない。初回アクセスで自動的に anonymous user が払い出され、`auth.uid()` が確定する。
- **localStorage canonical との互換性**: 匿名 session は cookie で維持されるため、ブラウザ単位の identity になる。これは現状の localStorage canonical 粒度と一致する。
- **メール登録の前段を作らない**: 登録フォーム / verification mail / password manager 統合などの周辺作業を Phase2 に持ち込まない。
- **Phase3 で email 昇格に拡張可能**: Supabase Anonymous Auth は `linkIdentity` で後から email / OAuth を後付けできる。anonymous user を捨てて作り直す必要がない。

### 2.4 メール登録を必須にしない理由

- **コンバージョン障壁**: 高校生向け学習支援アプリで「メール登録してから使う」を要求するとファネル離脱が増える。プロダクトの教育的価値を最大化するには、まず「触ってみる」を最優先する。
- **学校配布 / 共有端末への配慮**: 高校現場では共有端末や貸し出し iPad が珍しくない。メール必須は実運用で詰む。
- **Stripe 連携時に必要になった段階で初めて要求**: 課金が発生するときに **その user にだけ** メール / 領収書発行用 identity を要求する設計に倒す。それまでは Anonymous で全機能を提供する。
- **既存 UX を 1 ピクセルも壊さない要件**: Phase2 では login wall も email gate も置かない。導線追加は Phase3 以降の決定。

---

## 3. auth.users.id と display_user_id の役割分離（最重要）

### 3.1 auth.users.id（= auth.uid()）

**内部 owner key**。所有者判定 / 所有権チェック / 課金 identity / RLS の主体は **常にこの uuid**。

- **format**: uuid (Supabase Auth が払い出し)
- **mutability**: 不変（user 単位で 1 つ。anonymous→email 昇格時も維持）
- **visibility**: クライアントには `useCurrentUserId()` 経由で string として渡るが、ユーザー UI に直接表示しない
- **用途**:
  - `profiles.id` の PRIMARY KEY 値
  - `mirror_*` の将来的な user_id 列（Phase3+ で導入する場合）
  - RLS policy の `auth.uid() = X` 条件
  - Stripe customer 紐付け（Phase 後段）
  - その他あらゆる所有者判定の主体

### 3.2 display_user_id

**ユーザー表示用の文字列 ID**。所有者判定には **絶対に使わない**。

- **format**: `[a-z0-9_]`, 3〜20 文字, 先頭末尾英数字, 予約語禁止（[`lib/displayUserId.ts`](../../lib/displayUserId.ts)）
- **mutability**: 自由に変更可能（current STEP では UI が変更のみ提供）
- **visibility**: 完全に公開してよい文字列（profile 一覧 / プロフィールページ / 共有 URL の構成要素になる想定）
- **uniqueness**: DB UNIQUE 制約で保証。pre-check helper（`isDisplayUserIdTaken`）は UX nicety で、最終真実は UNIQUE 制約
- **用途**:
  - UI 表示
  - 将来の "プロフィール URL" の slug
  - 友達招待などの "見える ID"
- **やってはいけないこと**:
  - `display_user_id` を保存キー / 検索条件 / RLS 主体に使う
  - `display_user_id` を FK の参照先にする
  - `display_user_id` を Stripe customer の externalId にする
  - `display_user_id` から auth.uid() を逆引きする経路をサーバー側で作る

### 3.3 invariant

```
所有権 ↔ auth.users.id（uuid）
表示  ↔ display_user_id（文字列、変更可能、null 可）
```

両者の対応は profiles 行で **1:1** に解決されるが、**1 列で済む** という事実だけを使ってよい。display_user_id 経由で owner を引く経路は禁止。

---

## 4. RLS / Stripe / Save Owner — 必ず auth.users.id を使う

Phase2 期間中、以下の判定はすべて auth.users.id を主体にする。

| 判定 | 使う ID | 例 |
|---|---|---|
| RLS の row 所有者条件 | `auth.uid()` | `USING (auth.uid() = id)` |
| 行作成時の owner 列値 | `auth.uid()` | `INSERT ... WITH CHECK (auth.uid() = id)` |
| 行更新時の owner 列値 | `auth.uid()` | `UPDATE ... WHERE id = auth.uid()` |
| 課金対象の identity (将来) | `auth.users.id` | Stripe customer metadata |
| 既存データ紐付け (将来 Phase3+) | `auth.users.id` | `lib/*Storage.ts` の user_id 化 |
| permission / ロール判定 | `auth.users.id` | admin / staff フラグの所有者 |

display_user_id を **これらのいずれにも使わない**。display_user_id の重複チェック helper も「所有者判定」ではなく「文字列 uniqueness 検査」であり、owner identity ではない。

---

## 5. profiles に PII を入れない方針

### 5.1 現状の profiles 列

| 列 | 型 | PII 性 |
|---|---|---|
| `id` | uuid (auth.users.id) | 非 PII（uuid は単体では個人特定できない） |
| `display_user_id` | text | 非 PII（ユーザーが任意に選んだ識別子） |
| `plan` | text | 非 PII（free / paid 等の課金状態） |
| `created_at` / `updated_at` | timestamptz | 非 PII |

このため profiles を `SELECT TO authenticated USING (true)` で **全行 SELECT 可** にしている（[`supabase/schema.sql §18`](../../supabase/schema.sql)）。これが許容できるのは **profiles に PII が無い** という前提に依存する。

### 5.2 profiles SELECT を authenticated 全体に開いている理由

- `display_user_id` の重複チェック helper（`isDisplayUserIdTaken`）が、自分以外の行に同じ display_user_id が存在するかを SELECT で確認するため
- column-level RLS は Postgres / Supabase の標準 RLS では表現できない
- 列を全て非 PII に絞っていれば、全行 SELECT 可でも privacy 上のリスクが小さい
- duplicate の最終防衛は UNIQUE 制約。SELECT が拒否されても update 時の unique_violation で重複を検知できるが、UX として事前チェックを出したいので SELECT を開ける

### 5.3 将来 email / 学校名 / 本名 等を保存する場合（拡張時の代替案）

profiles を **そのまま列拡張するのは禁止**。以下のいずれかで再設計する。

**代替案 A: 別テーブル分離**

```
profiles                       (現状のまま、非 PII のみ)
profile_private (id uuid PK references profiles(id))
  - email text
  - real_name text
  - school text
  ...
  RLS: SELECT/UPDATE/INSERT only if auth.uid() = id（USING true は使わない）
```

- 行 SELECT を `auth.uid() = id` に絞れる
- 重複チェックが要らない PII 系列はこちらに置く
- profiles 側の "全員から読める" property を守ったまま PII を分離できる

**代替案 B: SECURITY DEFINER 関数**

profiles に PII 列を増やしつつ、重複チェックだけを SECURITY DEFINER 関数経由にする。

```sql
CREATE FUNCTION is_display_user_id_taken(p_display text, p_self uuid)
RETURNS boolean
SECURITY DEFINER
LANGUAGE sql
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE display_user_id = p_display
      AND id <> p_self
  );
$$;
```

- profiles SELECT policy を `auth.uid() = id` に閉じても重複チェックが残る
- ただし関数の grant 範囲・SECURITY DEFINER の運用負荷が増える

**選択基準**:

- 列が 1〜2 個（email のみ等）→ 代替案 A（別テーブル）
- 列が多く owner-only / display_user_id 重複チェックを残したい → 代替案 B（SECURITY DEFINER）

どちらを選ぶ場合も **profiles に直接列を追加するのは現契約違反**。PR を出す前に本ドキュメントを更新し、選択した代替案を明記すること。

---

## 6. Phase2 で許可される auth 関連の振る舞い

[`lib/supabase/README.md`](../../lib/supabase/README.md) "What this boundary deliberately does NOT do (yet)" の N=4 freeze 時点では明示的に禁止されていた以下が、**Phase2 で例外として許可**される:

- **anonymous session creation** — `lib/supabase/auth.ts:ensureAnonymousUser()`
- **currentUserId exposure** — `AuthProvider` 経由で `useCurrentUserId()` が `string | null` を返す
- **profile auto-ensure** — `AuthProvider` マウント時に `lib/supabase/profile.ts:ensureProfile()` が profiles 行を idempotent に確保
- **optional display_user_id management** — `/account` ページで display_user_id を表示 / 入力 / 重複チェック / 保存
- **optional email opt-in** — `/account/email` ページで `lib/supabase/email.ts:requestEmailChange()` 経由で `supabase.auth.updateUser({ email })` を呼び、`auth.users` に対する email change を要求する（STEP-AUTH-EMAIL-OPTIN-01）。`profiles` 列は追加しない。`updateUser({ email })` は即時の persist では無く、Supabase 標準の確認メールを送信するだけ。実際に `auth.users.email` が更新されるのはユーザーが確認リンクを開いた後で、それまでは `auth.users.email_change` に保留される。UI も「保存しました」ではなく **「確認メールを送信しました」** として表示する（state 名: `confirmation-sent`）。匿名 session は確認完了まで維持。導線は `/account` の任意リンクのみ（バナー / nudge / modal / required gate は付けない）

---

## 7. Phase2 でも禁止のまま

以下は Phase1 から継続して禁止。Phase2 PR でも runtime 配線を持ち込まない。

- **auth gating** — login しなければ画面が出ないような UI を作らない
- **login wall** — 既存ページに login モーダルを挟まない
- **existing feature UI blocking** — 志望理由書 / 自己分析 / 小論文 / Tutor の UI を Auth state で出し分けない
- **session-coupled rendering** — Server Component で session を見て分岐する SSR を入れない（hydration mismatch リスク + canonical を localStorage に保つため）
- **Stripe coupling** — 課金状態を runtime に組み込まない（plan='free' 以外を読む経路を作らない）
- **email required flow** — メール登録を必須化する経路 / バナー / nudge を出さない（opt-in の `/account/email` は §6 で明示的に許可。required / interstitial 化は引き続き禁止）
- **既存データの user_id 紐付け** — `lib/*Storage.ts` の各 store を user_id 化しない（Phase3 の責務）
- **mirror table への user_id 列追加** — `mirror_*` 4 テーブルは引き続き no-user-id（[phase1_boundary_freeze.md §2 Final Boundary Inventory](./phase1_boundary_freeze.md)）

---

## 8. Phase1 boundary freeze (N=4) は変更しない

Phase2 Auth は **mirror boundary を一切広げない**。具体的に:

- `lib/supabase/` 配下に追加されたのは `auth.ts` と `profile.ts` の 2 ファイルのみ。`mirrorXxx.ts` の N=4 構成（studentProfile / basicInfo / diagnosis / activityData）は **変更なし**
- 既存 mirror の trigger / payload / hash strategy / PII pattern / RLS は **変更なし**
- mirror 拡張は引き続き [phase1_boundary_freeze.md §5 Mirror Addition Gate](./phase1_boundary_freeze.md) を満たさない限り禁止
- abstraction は引き続き [phase1_boundary_freeze.md §6 Abstraction Threshold Rule](./phase1_boundary_freeze.md) を満たさない限り禁止

Phase2 Auth の追加は freeze 契約とは **直交** する。auth 層が増えても mirror 層は触らない。

---

## 9. Phase2 でも **やらない** こと（再掲）

`STEP-AUTH-01` / `STEP-AUTH-02` で明確に保留した非ゴール。Phase2 期間中、これらを「準備として配線する」ことも禁止する。

- **localStorage 移行** — `lib/*Storage.ts` の各 store を Supabase canonical 化しない（Phase3）
- **既存データの user_id 紐付け** — basicInfo / diagnosis / activity / statement / essay / interview / tutor / matching いずれの localStorage キーにも user_id を埋めない
- **Stripe** — `plan` 列は default 'free' のまま、UI / route / webhook を一切作らない
- **メール登録 UI（必須化のもの）** — sign-up form / "ログインしてください" gate / email verification を機能利用条件にする経路は作らない。`/account/email` の opt-in form は STEP-AUTH-EMAIL-OPTIN-01 で §6 に追加された例外であり、ここに含まれない
- **ログイン必須化** — login wall / auth gating / "ログインしてください" バナーを置かない
- **既存機能の導線変更** — Header / Nav / mypage / home の link 構成を変更しない

---

## 10. Auth boundary 拡張の gate

Phase2 期間中、auth 層を更に広げる PR を出す前に **本ドキュメントの更新を先行** させる。

具体的に gate される変更:

- `lib/supabase/auth.ts` のシグネチャ拡張（例: `linkIdentity` の export）
- `lib/supabase/profile.ts` の SELECT / UPDATE 対象列の追加
- `lib/supabase/email.ts` の拡張（読み取り経路 / email 以外の identity 列 / 任意 opt-in を超えるフローの追加）
- `profiles` テーブルへの列追加（[§5.3](#53-将来-email--学校名--本名-等を保存する場合拡張時の代替案) の代替案選択が必要）
- `AuthProvider` から expose する hook の追加（email / plan を直接 expose する場合等）
- 既存機能ページから `useCurrentUserId()` を読む配線（feature 側に owner 紐付けを始める場合は Phase3 として再計画）

doc-first ルール: **runtime PR より先に本ドキュメント PR をマージする**。runtime PR の付帯変更として契約を解除しない。

---

## 11. Freeze Declaration (Phase2 Auth)

> **Phase2 Auth boundary は anonymous session creation + profiles 行 + display_user_id management + optional email opt-in の 4 点に限定する。**

宣言:

- anonymous session の自動発行と `currentUserId` の expose を Phase2 の正式機能とする
- profiles テーブルは「auth canonical かつ非 PII」を維持する
- 任意メール登録は `auth.users.email` のみで完結させ、profiles 列は触らない（[§6](#6-phase2-で許可される-auth-関連の振る舞い)）
- 既存 mirror boundary（N=4 freeze）は変更しない
- 拡張は doc-first PR を経てから着手する
- Phase3 移行は本ドキュメントの後継（仮: `phase3_user_scoped_canonical.md`）で定義する

freeze 解除の **唯一の経路** は本ドキュメントの PR であり、runtime PR の付帯変更として解除しない。
