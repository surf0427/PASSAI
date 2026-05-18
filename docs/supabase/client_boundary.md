# Supabase Client Boundary

PASSAI に **Supabase をどう「入れていいか」** を決めるアーキテクチャ境界規約。
runtime 着手の前段として、`createClient` がコードベース上のどこに置かれ、どこからは触れず、どの責任が誰に帰属するかを固定する。

関連: [migration_phases.md](./migration_phases.md), [architecture_rules.md](../principles/architecture_rules.md), [student_profile_contract.md](../principles/student_profile_contract.md), [incremental_refactor_policy.md](../principles/incremental_refactor_policy.md), [localstorage_keys.md](../shared/localstorage_keys.md)

---

## 1. Purpose

- Supabase runtime 着手 **前** に、client 配置 / import 境界 / 環境変数アクセス / 失敗哲学を固定する
- 「最初に書かれた `createClient` 行が architecture を決める」事故を防ぐ
- canonical (localStorage) と mirror (Supabase) の責任分割を **コード境界として** 表現する規約を引く
- feature ごとの個別判断（page.tsx / route.ts / hooks / UI コンポーネントから直接 client を作る）を **architectural に禁止** する根拠を提供する
- [migration_phases.md](./migration_phases.md) の Phase 定義（特に Phase1 の mirror-only / best-effort）と整合した境界を引く

本ドキュメントは contract 専用であり、Supabase 関連の **実装はまだ一切存在しない** 前提で書かれている。実装着手は本ドキュメントに従って別 STEP で起票する。

---

## 2. Current Migration Position

- Phase: **S0 完了 / Phase1 未着手**（[migration_phases.md §2 Current State](./migration_phases.md)）
- Supabase 実装は完全に未導入（client / package / env / schema いずれも存在しない）
- canonical は **localStorage 一択**。`lib/*Storage.ts` が唯一の永続層窓口
- 認証は未導入。user identity に依存した UX はゼロ
- 本ドキュメントは「runtime 着手の **直前** に置く境界規約」であり、最初の `createClient` が書かれる前に PR として merge されることを想定する

つまり、ここで定義する境界は **「これから初めて書く supabase 関連コード」に最初から適用される** ものであり、既存実装の事後整理ではない。

---

## 3. Architectural Boundary Principles

Supabase を入れるときの不可侵原則。Phase 横断で守る。

1. **canonical 境界を壊さない**。Supabase の導入は canonical (localStorage) と mirror (Supabase) の責任を分けたまま行う。Phase1 において canonical ownership が暗黙に Supabase へ移ることがあってはならない（[migration_phases.md §4 Phase1](./migration_phases.md)）。
2. **Supabase は infrastructure 層に閉じ込める**。UI / page / hook / feature module から直接 import / instantiate しない。
3. **境界は名前と配置で表現する**。「mirror かどうか」「browser/server か」「canonical か」をディレクトリ・ファイル名・helper 名で見分けられる状態にする。
4. **UX は canonical のみで成立する**。Supabase が無効化された状態でも feature が完動する設計を維持する（restore / mirror / fallback いずれも canonical 経路の上にだけ乗る）。
5. **撤退可能性を維持する**。Supabase 境界に書かれた helper / client 配線は **同 PR 内で revert 可能** な粒度で導入する。境界外への漏れがないこと自体が撤退可能性の前提。
6. **境界更新は doc-first**。本ドキュメントを更新せずに境界（client 配置 / import ルール / env アクセス）を変えない。

---

## 4. Supabase Client Ownership Rules

Supabase client (`createClient` の戻り値) の **所有者** に関する規約。

- Supabase client の生成箇所は **専用の boundary file に集約する**（具体的なファイル名・配置は Phase1 着手 STEP で別途決定し、本ドキュメントを更新する）
- 当該 boundary file 以外で `@supabase/supabase-js` または同等パッケージから `createClient` を呼んではならない
- client インスタンスへの参照は boundary file が export する関数経由でのみ取得する（後述の Singleton Policy 参照）
- client インスタンスを feature module / UI / page / route が **長期保持** しない（render 跨ぎ・request 跨ぎでの retention は boundary 側の責任）
- client 設定（auth flow type / storage / fetch override 等）の決定権は boundary file が単独で持つ。feature 側はそれを上書きしない

> **NOTE**: 本ドキュメントの段階では、boundary file の **物理パスを敢えて固定しない**。理由は「Phase1 着手 STEP の最初の commit で命名規約と同時に決めて本ドキュメントへ追記する」運用にし、command-line で先に作って後で動かす二度手間を避けるため。同 STEP で path が確定したら本セクションに追記する。

---

## 5. Browser vs Server Client Separation

Supabase client は **browser 用と server 用で別 instance / 別 boundary file** にする。混ぜない。

- browser 用 client の責務:
  - browser から呼ばれる経路（page client component / hook 経由）でのみ使用
  - cookie / localStorage / session を browser 環境前提で扱う
  - import すること自体が browser bundle を膨らませる前提で、サーバ専用コードから import しない
- server 用 client の責務:
  - route handler / server component / server-only module からのみ使用
  - cookies / auth header 等を server 環境前提で扱う
  - 「server から呼ばれる helper」を browser bundle に混入させない

明確なルール:

- browser boundary file は **`"use client"` 文脈および client-only モジュール** からのみ import される
- server boundary file は **route handler / server component / server-only utility** からのみ import される
- 同一ファイルから browser 用 / server 用の両方を export しない（boundary file を分ける）
- 一方の boundary file 内部からもう一方の boundary file を import しない（cross-environment import の禁止）

なぜ分けるか:

- environment-specific な持ち物（cookies API / window / SSR 文脈）の隠蔽事故を防ぐ
- bundle leakage（server 用 secret や `service_role` 系 key が browser bundle に混入する事故）を architectural に防ぐ
- 後段（Phase2 / Phase3）で authenticated read / server-side mutation を入れる際、責任境界が既に分かれていれば差分が局所化する

---

## 6. Import Boundary Rules

Supabase に関わる import は **boundary file を経由する** 一方通行とする。

許可される import:

- boundary file → `@supabase/supabase-js`（または同等パッケージ）
- mirror helper / fallback helper（後述 §10）→ boundary file
- `lib/*Storage.ts`（canonical helper）→ mirror helper（mirror 起動経路として）
- route handler / server component → server boundary file（server コンテキストのみ）

禁止される import:

- `app/**/page.tsx` / `app/**/route.ts` → `@supabase/supabase-js` 直 import
- `app/**/page.tsx` / `app/**/route.ts` → `createClient` 直呼び出し（boundary 経由を強制）
- `components/**`（UI コンポーネント）→ Supabase client / mirror helper 直 import
- `hooks/**` → Supabase client 直 import（必要なら boundary 経由の薄い hook を boundary 隣接ディレクトリで提供する）
- `types/**` → Supabase ランタイム import（型のみ必要なら型 export 専用ファイルを boundary から提供する）
- mirror helper → UI / page / route の import（mirror は infrastructure 層に閉じる）

意図:

- 「UI が persistence を所有しない」原則を境界として強制する
- 散在した `createClient()` を **物理的に grep 一発で根絶可能** な状態に保つ
- 移行 phase が進んでも import 境界は同じ形を保つ（Phase2 で fallback read を入れても import 経路は boundary 一本のまま）

---

## 7. Environment Variable Access Policy

Supabase 接続に必要な環境変数（URL / anon key / service role key 等）へのアクセスは **boundary file 内部に閉じる**。

- `process.env.SUPABASE_*` / `process.env.NEXT_PUBLIC_SUPABASE_*` の参照は **boundary file 内のみ** 許可
- feature module / page / route / UI / hook / mirror helper から `process.env.SUPABASE_*` を直接読まない
- boundary file は env を **読み出しの最初の関数呼び出しで一度だけ評価** し、以降は cached value を返す（再評価で env 変動を観測しない）
- env が未定義のときの挙動は boundary file が決める（Phase1 では「mirror を no-op として skip」を default とし、user-visible エラーを出さない）
- server-only env（`service_role` 等）は server boundary file からのみ読む。browser boundary file は **server 専用 env を一切参照しない**
- env の追加 / 削除 / rename は boundary file の PR と同 PR で行う（feature PR で env だけ追加するのを禁止）

なぜ:

- 後段で env 命名変更 / secret 管理移行を行う際、影響範囲が boundary file の数行に閉じる
- browser bundle に server 専用 secret が漏れる事故を architectural に防ぐ
- 「env が無いと feature が壊れる」を Phase1 の段階では作らない（mirror skip 可能であるため）

---

## 8. Singleton Policy

Supabase client は **boundary file 内で singleton 化** する。

- 同一 environment (browser / server) 内で、同一設定の client は **プロセス（または tab）あたり 1 インスタンス** とする
- boundary file は singleton インスタンスを内部 module 変数で保持し、`getBrowserSupabaseClient()` / `getServerSupabaseClient()` のような関数経由で渡す（具体的関数名は Phase1 着手 STEP で決定）
- consumer 側は呼び出しごとに getter を呼ぶ（変数として長期保持しない）。これにより boundary 側で `null` 化 / 差し替え / disable を制御可能にする
- test / SSR / route handler などで singleton が問題になる場合は boundary file 内部で per-request scope を導入する（境界の外には漏らさない）
- feature 側で client を **new し直さない**。client 設定差分が必要なら boundary file に新しい factory を追加する

意図:

- connection / auth state / cache の重複を防ぐ
- mirror disable / kill-switch を boundary 一箇所で実装可能にする
- 観測（mirror 成功率 / fallback hit 率）の集約ポイントを boundary に一本化する

---

## 9. Runtime Safety Constraints

[migration_phases.md §6 Runtime Safety Rules](./migration_phases.md) を本ドキュメントの境界視点で再宣言する。Phase1 で特に重要。

- canonical 書き込み（localStorage）よりも **前** に Supabase を await しない
- mirror helper は canonical 書き込み成功 **後** にしか起動しない
- mirror helper の戻り値で UI render を block しない（fire-and-forget が default）
- restore 経路（reload / cache hit / `sourceHash` 一致時）は Phase1 では Supabase を一切呼ばない
- mirror 失敗は throw しない（boundary / helper 層で吸収）
- auth-dependent UX を Phase1 に持ち込まない（boundary が user 未確定時に no-op に倒すこと）
- mirror helper は idempotent に設計する（同一 input の再 mirror が壊れない）
- mirror 経路 / fallback 経路の latency が canonical 経路の latency に **加算されない** こと

---

## 10. Mirror Helper Placement Rules

mirror helper の **物理配置と命名** に関する規約。

- mirror helper は boundary file と **同じ infrastructure 層** に配置する（feature ディレクトリ配下に置かない）
  - 物理パスは Phase1 着手 STEP で決定し本ドキュメントに追記する
- 1 つの mirror helper = 1 canonical entity を mirror する責務に限定する（複数 entity をまたぐ helper は作らない）
- mirror helper は以下の呼び出し規約を守る:
  - **fire-and-forget** が default。caller は await しないか、await しても結果を UI 判定に使わない
  - **best-effort**: 失敗を内部で吸収し、observability に記録するに留める
  - **idempotent**: 同一 input の再実行が壊れない
- 命名は [migration_phases.md §7 Naming Conventions](./migration_phases.md) に従う:
  - `mirrorXxxToSupabase`, `bestEffortMirrorXxx` のみ許可
  - `saveXxx` / `persistXxx` / `syncXxx` / `saveXxxToSupabase` は **禁止**（canonical ownership / 双方向 sync を含意するため）
- mirror helper は **restore (read) 経路と分離** する。同一ファイルに restore と mirror を同居させない（責任が混ざる）
- mirror helper は boundary 経由でしか Supabase client を取得しない（`createClient` 直叩き禁止）

---

## 11. Feature Integration Rules

feature module（StudentProfile / statement / matching / activity / essay / interview など）が mirror 経路を組み込む際のルール。

- canonical helper（`lib/*Storage.ts` 配下の `saveXxx` 等）の **後段** にのみ mirror 呼び出しを差し込む
- canonical helper の signature / 戻り値型 / 例外契約は mirror 導入で変更しない
- mirror 呼び出しは canonical helper 内部から起動するか、canonical helper の caller 側で canonical 成功確認後に起動する（どちらにするかは feature ごとに決定し、PR description に明記する）
- feature module は Supabase client を直接持たない。mirror helper を呼ぶだけ
- feature の restore / cache / version semantics（`*InputHash`, `sourceHash` 等）は mirror 導入で **一切変更しない**（[migration_phases.md §10 Backward Compatibility Policy](./migration_phases.md)）
- 新規 feature を mirror 対応させる順序は [migration_phases.md §8 Rollout Policy](./migration_phases.md) に従う（StudentProfile から開始）
- feature の Phase1 移行 PR は **mirror 配線 1 件のみ** を含む（cross-cutting refactor を混ぜない、[incremental_refactor_policy.md](../principles/incremental_refactor_policy.md)）

---

## 12. Error Handling Philosophy

Supabase 関連のエラーハンドリングは Phase 単位で意図的に異なる強度で設計する。Phase1 は最弱。

| 失敗種別 | Phase1 (mirror-only) | 補足 |
|---|---|---|
| Supabase 書き込み失敗 | 吸収 / observability 記録のみ / UX 無傷 | retry しない（best-effort 定義） |
| Supabase 認証未確定 | mirror を no-op として skip | UX に出さない、loading にしない |
| boundary file 内 env 未定義 | mirror を no-op として skip | feature を壊さない |
| network 切断 | 吸収 / observability 記録 | UI の通常 offline UX があるならそちらに従う |
| schema mismatch | mirror payload を drop / observability 記録 | retry しない |
| canonical (localStorage) 書き込み失敗 | 既存挙動を維持 | Supabase 側で補おうとしない（canonical 境界を壊すため） |

原則:

- **mirror 失敗は throw も toast も出さない**。boundary / helper 層で例外境界を引く
- **restore semantics は mirror 成否に依存しない**。restore は canonical 経路のみで完結する
- **cache validity は mirror 成否に依存しない**。`*InputHash` / `sourceHash` 等の cache 判定は localStorage の状態のみで決まる
- **「失敗を見つけたら直す」のは Phase 進行判断の文脈で行う**（observability 観察結果に基づき、Phase2 移行 STEP の中で対処方針を決める）

---

## 13. Observability Expectations

mirror / boundary の挙動は **後段 Phase の判断材料** になるため、観測可能性を導入と同時に確保する。

- mirror helper は **成功 / 失敗 / skip（no-op）** の 3 結果を区別して記録する
- 失敗種別（auth 未確定 / network / schema / unknown）を粗粒度で分類する
- 記録は user-visible UI には出さない（Phase1 の non-goal）
- 既存の AI 観測枠（[ai_usage_observability.md](../principles/ai_usage_observability.md) / [ai_cache_observability.md](../principles/ai_cache_observability.md)）に **乗せるか独立 sink にするか** は Phase1 着手 STEP で決定する
- 観測 sink への書き込み自体が失敗しても mirror helper の挙動を変えない（観測も best-effort）
- boundary file は kill-switch を持ち、観測異常時に mirror 全停止できる手段を提供する（停止判断は手動 / 設定。Phase1 では自動 circuit breaker は導入しない）
- Phase 進行判断（Phase1 → Phase2）の前提として、最低限以下を観測可能にする:
  - mirror 試行回数 / 成功率 / 失敗種別分布
  - feature 単位の mirror 起動率（canonical 書き込みのうち mirror が走った割合）
- 観測項目の **正式リスト** は Phase1 着手 STEP で別ドキュメント（例: `docs/supabase/mirror_observability.md`）として起票する

---

## 14. Anti-patterns

以下は **境界違反** として禁止。レビュー / PR 段階で reject する根拠とする。

- **UI 内で Supabase を直接使う**
  - 例: `components/**/*.tsx` 内で `createClient` を import する / mirror helper を直呼びする
  - 理由: UI が persistence infrastructure を所有してはならない
- **page.tsx / route.ts で `createClient` を直接呼ぶ**
  - 例: route handler 冒頭で `const supabase = createClient(url, key)` を書く
  - 理由: boundary file の singleton を迂回し、設定 / observability / kill-switch を破壊する
- **scattered client initialization**
  - 例: feature ごとに別々の `createClient` を持つ / 同一 environment で複数 instance を作る
  - 理由: connection / auth state / 観測の重複と分散を生む
- **feature-local Supabase 初期化**
  - 例: `app/{feature}/lib/supabaseClient.ts` を作って feature 内で完結させる
  - 理由: 境界の物理位置が分散し、Supabase 影響範囲を grep で特定できなくなる
- **silent canonical ownership shift**
  - 例: Phase1 のまま mirror 経路が無いと feature が壊れる構造を作る / restore 経路が Supabase に依存する
  - 理由: Phase 宣言と実装の乖離は移行全体の予測可能性を破壊する
- **feature-specific schema 前提を boundary に持ち込む**
  - 例: boundary file が「statement テーブルがある前提」の helper を露出する
  - 理由: boundary file は infrastructure であり、特定 entity 知識を持たない（mirror helper 側に閉じる）
- **restore と mirror を同一ファイルで実装する**
  - 例: 1 つの helper が「localStorage 復元 + Supabase mirror + Supabase fallback」を兼ねる
  - 理由: 失敗哲学と所有権が混在し、Phase 移行時の責任分割が崩れる
- **auth-dependent UX を Phase1 で導入する**
  - 例: ログイン UI / 「Supabase に保存できませんでした」トースト / mirror 起動を user action として露出する
  - 理由: Phase1 は anonymous でも完動する前提（[migration_phases.md §6](./migration_phases.md)）
- **`save`/`persist`/`sync` を mirror helper に使う**
  - 例: `saveStudentProfileToSupabase()` という関数名で best-effort mirror を実装する
  - 理由: canonical ownership / 双方向 sync を含意し誤読を招く（[migration_phases.md §7](./migration_phases.md)）
- **boundary 越え import**
  - 例: browser boundary file から server boundary file を import / その逆
  - 理由: bundle leakage / 隠れた cross-environment 依存を生む
- **`process.env.SUPABASE_*` を feature 側で直接読む**
  - 例: route handler 冒頭で `process.env.NEXT_PUBLIC_SUPABASE_URL` を参照する
  - 理由: env 命名変更 / secret 管理移行で爆発する箇所を増やす
- **mirror 失敗を UI エラーとして表面化**
  - 例: mirror 失敗を `toast.error()` 化、`throw` してエラー境界を発動させる
  - 理由: Phase1 の failure philosophy（UX 無傷）に反する
- **cache validity を mirror 成否に紐付ける**
  - 例: mirror 失敗時に `*InputHash` を invalidate する
  - 理由: canonical cache 意味論が Supabase 状態に汚染される

---

## 15. Future Runtime TODOs

本ドキュメントの範囲外。Phase1 着手 STEP 以降で順に消化する。

- **boundary file の物理パス / 関数名の確定**
  - browser boundary / server boundary の path、export 関数名、singleton 関数名を Phase1 着手 STEP で決定
  - 確定後、本ドキュメント §4 / §5 / §8 に追記
- **mirror helper の物理パス / 命名の確定**
  - infrastructure 層内の配置ディレクトリ、命名規約適用例を Phase1 着手 STEP で決定
  - 確定後、本ドキュメント §10 に追記
- **環境変数の正式名 / 取得経路**
  - URL / anon key / service role key の env 名、取得タイミング（boundary file の lazy evaluation）を Phase1 着手 STEP で決定
  - 確定後、本ドキュメント §7 に追記
- **observability sink の決定**
  - 既存 AI 観測枠に乗せるか独立 sink を切るか
  - 確定後、本ドキュメント §13 と新規 `docs/supabase/mirror_observability.md`（仮）に追記
- **kill-switch の実装方式**
  - boundary 内 flag / env / runtime config のいずれにするか
  - 確定後、本ドキュメント §13 に追記
- **schema / table 設計**
  - 本ドキュメントの範囲外（`docs/supabase/schema_overview.md`（仮）として別 STEP で起票）
- **認証 / RLS 設計**
  - Phase2 / Phase3 前提。Phase1 では取り扱わない
  - 認証導入は単独 STEP として独立させ phase 進行 PR と混ぜない（[migration_phases.md §12](./migration_phases.md)）
- **repository pattern 抽象化判断**
  - [architecture_rules.md §Supabase 移行に向けて](../principles/architecture_rules.md) の TODO と整合
  - 早すぎる抽象化を避け、Phase2 / Phase3 の感触で判断する
- **既存 `lib/*Storage.ts` legacy normalization の扱い**
  - 同上。Phase3 / Phase4 移行時の判断材料を各 storage に注釈で残す

---

## 締めくくり

Supabase は **infrastructure 層に閉じた boundary file 経由で** のみ PASSAI に入る。
UI / page / route / hook / feature module が `createClient` や `process.env.SUPABASE_*` を直接触る瞬間に、この移行は予測不能になる。
本ドキュメントの境界規約は、最初の Supabase 関連 commit が書かれる **前に** 適用されることで初めて意味を持つ。
最初の `createClient` 行が architecture を決めてしまわないよう、boundary を先に文書として確定する。
