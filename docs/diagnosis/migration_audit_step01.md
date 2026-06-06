# STEP-DIAGNOSIS-MIGRATION-01 設計監査

PASSAI 現行診断（`/diagnosis`・5問・4タイプ）を juken-shindan 正式版（`/quiz`・15問・9タイプ）へ置き換えるための **設計・監査のみ**（コード変更なし）。

調査対象リポジトリ:
- PASSAI: `/Users/yk/paid-app`
- juken-shindan: `/Users/yk/juken-shindan`

---

## 0. エグゼクティブサマリ（先に結論）

1. **`DiagnosisType`（`1|2|3|4`）は 2 つの別タクソノミーで共有されている** — `/diagnosis` と self-analysis（`inferAnalysisType`）。9タイプは **文字列キー（`ExamType`）** なので、この共有型を書き換えると self-analysis が巻き込まれる。→ **`types/diagnosis.ts:DiagnosisType` は触らず、新規 `ExamType` を別系統として追加する**。これが最大リスク（R12 タクソノミー衝突の再来）。
2. **juken-shindan は既に独自の Supabase 永続層（`exam_diagnosis_results` + `exam_diagnosis_answers`）を持ち、`score_vector` を保存している** → PASSAI の **Phase 3 Option B（scoreVector 非保存・answers 唯一の真実）と矛盾**。→ juken の永続層（`saveDiagnosis.ts` / `diagnosisProfile.ts` / `diagnosisStorage.ts`）は **移植しない**。PASSAI 既存の `diagnosis_logs`（snapshot・answers + resultType のみ）を維持する。
3. juken の **scoring 本体（重み付き加点・normalized・安定タイブレーク）と content（questions/results）は流用価値が高い**。ただし配点モデルが PASSAI 現行と構造的に違う（後述 §1.1）ため、PASSAI 現行 `lib/diagnosisScoring.ts` を 9タイプ用に **置換するのではなく別ファイルで併設**する。
4. legacy 4タイプは **削除せず凍結併存**。`ExamType` 系統を新規追加し、UI 経路（`/diagnosis`）をフラグ/段階で切替える最小リスク構成を推奨。

---

## 1. juken-shindan 側：診断ロジックに必要なファイル全列挙

| 種別 | ファイル | 役割 |
|---|---|---|
| 型定義 | `types/index.ts` | `EXAM_TYPES`（9タイプ canonical 配列）/ `ExamType` / `isExamType` / `Question` / `Option` / `Point` / `Result` / `Answer` / `DiagnosisScoreVector` / `DiagnosisResult` / `DiagnosisProfile` |
| 質問データ | `data/questions.ts` | 15問・各4択。`Option.points: {type, score}[]`（1選択肢が複数タイプへ 3点/1点を配る重み付き） |
| 結果データ | `data/results.ts` | 9タイプの `Result`（name / catchphrase / description / strategy / universities / universityCharacter / reason / ngBehavior / ngExplanation / badExamples / countermeasure） |
| 採点 | `lib/scoring.ts` | `computeMaxPossible` / `computeScoreVector` / `rankTypes`(FNV-1a 安定タイブレーク) / `calculateDiagnosisResult` / `SECONDARY_THRESHOLD`(0.15) |
| 採点ラッパ | `lib/calculateResult.ts` | 後方互換 `calculateResult(answers): string`（primaryType だけ返す） |
| UI（質問） | `app/quiz/page.tsx` / `components/Question.tsx` | 出題フロー |
| UI（結果） | `app/result/[type]/page.tsx` / `components/Result.tsx` | 結果表示（タイプ別） |
| Tutor 連携 | `lib/diagnosisContext.ts` | `buildDiagnosisContext(profile)` — system-context 文字列生成（純粋関数） |
| Tutor 連携 | `lib/tutorContext.ts` | `buildTutorDiagnosisSection` / `appendDiagnosisContext`（baseContext へ追記） |
| 永続(読) | `lib/diagnosisProfile.ts` | `exam_diagnosis_results` 行 → `DiagnosisProfile` / `getLatestDiagnosis` / `getRecentDiagnoses` |
| 永続(書) | `lib/saveDiagnosis.ts` | `saveDiagnosisIfAuthenticated`（results + answers を INSERT） |
| 永続(payload) | `lib/diagnosisStorage.ts` | `DIAGNOSIS_VERSION` / `buildResultInsert` / `buildAnswerInserts` / `isDiagnosisScoreVector` / `toExamTypeOrNull` |
| Supabase | `lib/supabaseClient.ts` | client 生成 |
| DB | `supabase/`（DDL） | `exam_diagnosis_results` / `exam_diagnosis_answers` テーブル |
| テスト | `lib/*.test.ts`（scoring / diagnosisStorage / diagnosisContext / saveDiagnosis / diagnosisProfile / tutorContext） | 移植時の仕様参照に有用 |

### 1.1 配点モデルの構造差（重要・移植判断の根拠）

- **juken**: 1選択肢が複数タイプへ **重み（3 or 1）** を配る。`maxPossible[type]` = 各問で「そのタイプに最も加点する選択肢1つ」を合計（理論最大スコア）。
- **PASSAI 現行**: 1選択肢 = 1タイプに **+1点固定**。`maxPossible[type]` = 「そのタイプの選択肢総数（面積）」で面積偏りを是正（`lib/diagnosisScoring.ts` 冒頭コメント参照）。
- → 9タイプ移植では **juken の `computeMaxPossible`（重み前提・理論最大）をそのまま使う**。PASSAI の面積ベース算出を流用してはいけない（juken データは重み付きなので面積定義は誤った正規化になる）。

---

## 2. 移植可否の分類（流用 / 修正 / 全面書き換え）

### A. そのまま流用可能（コピーで動く・PASSAI 依存なし）
- `data/questions.ts`（15問データ）
- `data/results.ts`（9タイプ結果コンテンツ）
- `types/index.ts` の **content 系のみ**：`EXAM_TYPES` / `ExamType` / `isExamType` / `Question` / `Option` / `Point` / `Result` / `Answer` / `DiagnosisScoreVector` / `DiagnosisResult`
- `lib/scoring.ts`（`computeMaxPossible` / `computeScoreVector` / `rankTypes` / `calculateDiagnosisResult`）
- `lib/diagnosisContext.ts`（Tutor 文字列生成・純粋関数）
- 各 `*.test.ts`（仕様の参照元として）

### B. 修正が必要（PASSAI 規約・import path・命名に合わせる）
- `app/result/[type]/page.tsx` / `components/Result.tsx` → PASSAI のデザイン体系（button_system / accordion_system / Tailwind トークン）に合わせて作り直し。ロジックは流用。
- `app/quiz/page.tsx` / `components/Question.tsx` → PASSAI の `/diagnosis` UI 既存パターン（`useSyncExternalStore` マウント flag・localStorage 復元）に合わせて統合。
- `lib/tutorContext.ts`（juken版） → PASSAI の Tutor は **別アーキ**（`lib/contextBuilders/tutorContext.ts` が Supabase から読む server-only 層）。juken の `appendDiagnosisContext` は流用せず、**PASSAI 側 `loadDiagnosisContext` / `DIAGNOSIS_TYPE_HINTS` を 9タイプ対応に拡張**する（§6）。
- `types/index.ts` の **`DiagnosisProfile`**（DB 結合型）→ Option B 採用の PASSAI では DB に scoreVector を持たないため、この形のまま使えない。Tutor hint に必要な部分（type → label/strategy/ngBehavior）だけ抽出して使う。

### C. 全面書き換え / 移植しない（Option B・既存境界と矛盾）
- `lib/saveDiagnosis.ts`（juken版）— **移植しない**。`score_vector` を DB INSERT する。PASSAI は `diagnosis_logs`（answers + resultType の snapshot・upsert）を既に持つ。
- `lib/diagnosisProfile.ts` / `lib/diagnosisStorage.ts`（juken版の DB payload 部分）— **移植しない**。`score_vector` 列前提。`exam_diagnosis_results` / `exam_diagnosis_answers` テーブルは PASSAI に作らない。
- `lib/supabaseClient.ts`（juken版）— 不要。PASSAI は `lib/supabase/*` の確立された境界がある。
- juken の `supabase/` DDL（exam_diagnosis_* テーブル）— 作成しない。

---

## 3. PASSAI 側：影響を受けるファイル全列挙

### 型・スコアリング（中核）
| ファイル | 影響 | 内容 |
|---|---|---|
| `types/diagnosis.ts` | **触らない（重要）** | `DiagnosisType=1|2|3|4` は self-analysis と共有。9タイプは新規 `ExamType` を別ファイルで定義。 |
| `lib/diagnosisScoring.ts` | 併設（凍結） | 4タイプ用。残す。9タイプ用は `lib/examDiagnosisScoring.ts` 等を新設。 |
| （新規）`lib/examScoring.ts` 等 | 新設 | juken `scoring.ts` + `questions.ts` + `results.ts` の移植先 |

### UI（`/diagnosis` 経路）
| ファイル | 影響 |
|---|---|
| `app/diagnosis/page.tsx` | 4タイプ `RESULT_TYPES` / `calcDiagnosisResultType` / 番号バッジ表示。9タイプ切替の主戦場。 |
| `app/diagnosis/layout.tsx` | 軽微（メタ等） |
| `app/home/page.tsx` | `<DiagnosisTypeCard />` を描画 |
| `app/home/DiagnosisTypeCard.tsx` | **`isResultUsable` が `t!==1..4` で弾く** → 9タイプ結果を全部 reject し PromoCard 落ち。要改修 or source 分岐追加。 |
| `app/home/diagnosisFeedback.ts` | `DIAGNOSIS_FEEDBACK: Record<DiagnosisType,…>`（4タイプ）。9タイプ feedback を別テーブルで追加。 |
| `app/self-analysis/run/page.tsx` | `<DiagnosisTypeCard>` を inline 利用。card 改修の波及確認。 |

### 永続化（3 経路すべて）
| ファイル | 影響 |
|---|---|
| `lib/diagnosisStorage.ts` | `DiagnosisResult.resultType: DiagnosisType`（数値）。9タイプは文字列 → 型・保存形を分岐 or 拡張。 |
| `lib/supabase/mirrorDiagnosis.ts` | anonymous mirror。`SCHEMA_VERSION="2"` / hash `{answers,resultType}`。**bump 必須**。コメントの「DiagnosisType enum extends」トリガに該当。 |
| `lib/supabase/diagnosisLogs.ts` | durable `diagnosis_logs`。`SCHEMA_VERSION="2"`（mirrorと**二重管理・同時 bump 必須**）。 |
| `lib/repository/diagnosisRepository.ts` | dualWrite / backfill / restore。payload を素通しなので型変更の波及のみ。 |
| `app/components/AuthProvider.tsx` | backfill/restore 呼び出し。経路は不変。 |

### Tutor 連携
| ファイル | 影響 |
|---|---|
| `lib/contextBuilders/tutorContext.ts` | `DIAGNOSIS_TYPE_HINTS: Record<number,…>`（1-4）。`loadDiagnosisContext` が **`typeof resultType==='number'`** で判定 → **文字列 resultType だと無言で hint 無し**。9タイプ hint へ要改修。 |
| `lib/hash/tutor.ts` | プロンプト hash version（v19）。診断 hint 文言が変われば bump 検討。 |
| `app/api/tutor/route.ts` | section 注入位置。経路は不変（文言は tutorContext 経由）。 |

### マイページ・その他
| ファイル | 影響 |
|---|---|
| `lib/mypage/loadMypageData.ts` | `applicantType: DiagnosisType|null = diagnosis.resultType`。detail `タイプ ${resultType}`。 |
| `app/mypage/page.tsx` | `タイプ {header.applicantType}` を直描画 → 文字列だと「タイプ riaju」表示。要ラベル化。 |
| `app/mypage/EmptyState.tsx` | `hasDiagnosis` 真偽のみ。影響軽微。 |

### QA / ドキュメント
| ファイル | 影響 |
|---|---|
| `scripts/diagnosis-scoring-qa.ts` | 4タイプ scoring QA。9タイプ用 QA を別途追加。 |
| `scripts/diagnosis-taxonomy-qa.ts` | TYPE_FEEDBACK vs DIAGNOSIS_FEEDBACK の番号衝突検証。9タイプ追加時に拡張。 |
| `docs/supabase/diagnosis_mirror_schema_preview.md` / `diagnosis_post_apply_checklist.md` | SCHEMA_VERSION / payload 変更を追記。 |
| `docs/release/freeze.md` | N=4 mirror 境界凍結に diagnosis 含む。9タイプ拡張は凍結契約の範囲内変更（hash/version bump）として記録。 |

---

## 4. legacy 4タイプを残したまま 9タイプへ切替える最小リスク構成

**方針：番号系（DiagnosisType 1-4）と文字列系（ExamType 9）を「別タクソノミーとして恒久併存」させる**（home の R12 Option B と同じ思想＝「番号変換せず、来歴で出し分け」をスケールアップ）。

```
types/diagnosis.ts        ← DiagnosisType(1-4) 不変（self-analysis と共有・凍結）
types/examDiagnosis.ts    ← 新規: ExamType(9) / Question / Result …（juken types を移植）
lib/diagnosisScoring.ts   ← 4タイプ 採点 凍結（消さない）
lib/examScoring.ts        ← 新規: juken scoring 移植（9タイプ）
data/examQuestions.ts     ← 新規: juken questions
data/examResults.ts       ← 新規: juken results
```

- 保存キー: `passai_diagnosis_result`（4タイプ）はそのまま。9タイプは **別キー**（例 `passai_exam_diagnosis_result`）にして混在を物理分離 → 既存 LS データ・mirror・logs の互換を一切壊さない。
- `diagnosis_logs` payload: `resultType` が number(1-4) と string(9種) の両方を取り得るよう、読み手（tutorContext / mypage / DiagnosisTypeCard）を **「number なら旧、string なら新」で判別**（home の `resolved.source` 分岐と同パターン）。これなら DB migration 不要。
- UI 切替: `/diagnosis/page.tsx` に **kill-switch / feature flag**（`mirrorConfig` 同様の runtime flag）を置き、4→9 をフラグで切替。問題時は即ロールバック。
- 段階開放: flag OFF（現行4タイプ） → 内部のみ ON → 全開放、の 3 段。

**削除しないことの担保**: `lib/diagnosisScoring.ts` / `RESULT_TYPES` / `DIAGNOSIS_FEEDBACK` / `DIAGNOSIS_TYPE_HINTS`(1-4) を残し、`scripts/diagnosis-scoring-qa.ts` の 4タイプ QA も green のまま維持。

---

## 5. Phase 3 Option B との整合性

**結論：維持できる。ただし juken の永続層は採用しないことが条件。**

- PASSAI の現行真実源は `DiagnosisResult.answers: number[]`。scoreVector は保存していない（`lib/diagnosisStorage.ts` / `diagnosis_logs` payload に無い）。再計算は `calcDiagnosisResultType(answers)` で都度実施。→ Option B 準拠。
- 9タイプでも **answers（15問・各 selectedOptionIndex）を保存し、resultType/secondaryType/scoreVector は都度 `computeScoreVector(answers, examQuestions)` で再計算**すれば Option B を完全維持できる。
- **維持できなくなる箇所＝唯一の矛盾点**: juken の `saveDiagnosis.ts` / `diagnosisStorage.ts` / `exam_diagnosis_results.score_vector` 列は **scoreVector を DB に保存する設計**。これをそのまま移植すると Option B 違反。→ §2-C の通り **移植しない**。PASSAI 側で answers を保存し、表示・hint 時に再計算する。
- 注意: 9タイプの `secondaryType`（`SECONDARY_THRESHOLD=0.15`）も **保存せず answers から再計算**する。版（questions/scoring）を跨ぐと再計算結果が変わり得るため、`DIAGNOSIS_VERSION`（juken: `questions-2026.06`）相当を payload に持たせ、再計算時の version 整合を取る（既存 `schema_version` で代替可）。

---

## 6. Tutor 連携の現状と 9タイプ移行方針

### 6.1 現在「診断情報が Tutor に渡る」箇所（全列挙）

唯一の経路は **server-only の `lib/contextBuilders/tutorContext.ts`**:
1. `loadDiagnosisContext(client,userId)` が `diagnosis_logs.payload` を読む。
2. `payload.resultType`（number）を `DIAGNOSIS_TYPE_HINTS[1..4]` で **会話補助 hint 文へ言い換え**。
3. `buildTutorSupabaseContextSection` が `・保存情報からは、{typeHint}。` の1行として `【保存済みの生徒情報】` section に統合。
4. `app/api/tutor/route.ts`（L421 付近）が section を SYSTEM prompt へ注入。hash は `lib/hash/tutor.ts`(v19)。

※ juken 側 `lib/tutorContext.ts` / `diagnosisContext.ts` は **PASSAI では使われていない**（別アーキ）。移植しても接続されない。

### 6.2 現状の遵守状況（前提との突合）
PASSAI の現行 Tutor 連携は既に前提を満たしている:
- ✅ タイプ名を直接渡さない（hint 文へ言い換え。`DIAGNOSIS_TYPE_HINTS` はラベル名を出さない）
- ✅ score を直接渡さない（resultType を hint 化するのみ。scoreVector は読まない）
- ✅ raw JSON を渡さない（`readSnapshotPayload` で payload から resultType のみ抽出）
- ✅ 補助的傾向情報のみ（「参考情報・最新発言優先・断定禁止」を section 冒頭で明記）

### 6.3 9タイプ移行時：渡すべき / 渡してはいけない
**渡してよい（補助的傾向 hint へ言い換え）**:
- 9タイプそれぞれの **strategy（強み起点）/ ngBehavior（注意傾向）を、断定しない支援方針へ言い換えた hint**。
  例（riaju）: 「人や環境を活かして進めやすいよう一緒に整理していくとよさそうです」。
- → `DIAGNOSIS_TYPE_HINTS` を **`Record<ExamType,string>`（9種）として新設**し、`loadDiagnosisContext` を **number→旧表 / string→新表** で分岐。

**渡してはいけない**:
- ❌ タイプ名（`リア充タイプ` 等）・catchphrase をそのまま
- ❌ scoreVector / normalized / raw（数値）
- ❌ universities（推薦大学リスト）— 断定的進路誘導になるため hint に含めない
- ❌ badExamples / ngExplanation の生文 — 「あなたは〜しがち」と断定化しやすい。傾向の言い換えに留める
- ❌ payload 丸ごと（raw JSON）

**改修必須の落とし穴**: `loadDiagnosisContext` の `typeof resultType === 'number'` ガードは、9タイプ（string）resultType を **無言でスキップ**（hint 無し）してしまう。→ 文字列分岐を必ず追加。

---

## 7. 推奨移行手順（実装順序）

> 各 Step は独立 PR 想定。Step 1–6 は既存4タイプ・既存保存・Tutor に一切触れず追加のみ（リスク最小）。切替は Step 8 のフラグで初めて発生。

- **Step 1｜型・データ移植（純追加）**
  `types/examDiagnosis.ts`（juken `types/index.ts` の content 系）/ `data/examQuestions.ts` / `data/examResults.ts` を新設。`DiagnosisProfile` の DB 結合形は持ち込まない。
- **Step 2｜scoring 移植（純追加・テスト付き）**
  `lib/examScoring.ts`（juken `scoring.ts`：`computeScoreVector` / `rankTypes` / `calculateDiagnosisResult` / `SECONDARY_THRESHOLD`）。juken の `*.test.ts` を移植して green を確認。**maxPossible は juken の理論最大方式を採用**（面積方式にしない）。
- **Step 3｜結果コンテンツ表示の QA スクリプト**
  `scripts/diagnosis-scoring-qa.ts` を参考に 9タイプ版 QA（decisive ケースで各タイプが自分に勝つこと・同点安定性）を追加。**API コスト無しの純ロジック QA**。
- **Step 4｜UI（フラグ裏で）**
  `/diagnosis/page.tsx` に 9タイプ版フロー（15問・結果表示）を **feature flag OFF 状態で** 実装。保存キーは新規 `passai_exam_diagnosis_result`、保存は **answers のみ**（Option B）。4タイプ経路は不変のまま残す。
- **Step 5｜永続化の文字列対応**
  `diagnosisStorage` / `mirrorDiagnosis` / `diagnosisLogs` を resultType=string も受けられるよう拡張。`SCHEMA_VERSION` を `2→3` に **mirror と logs 同時 bump**。`diagnosis_logs` は payload 互換（number/string 両対応）。DB DDL 変更なし。
- **Step 6｜読み手の両対応（Tutor / home / mypage）**
  - `tutorContext.ts`: 9タイプ `DIAGNOSIS_TYPE_HINTS`(ExamType) 追加 + number/string 分岐。
  - `DiagnosisTypeCard.tsx` / `diagnosisFeedback.ts`: 9タイプ feedback テーブル + source 分岐（既存 R12 パターン踏襲）。`isResultUsable` の `1..4` ガードを系統別に。
  - `loadMypageData.ts` / `mypage/page.tsx`: applicantType を **ラベル化**（`タイプ {number}` 直描画をやめ、type→表示名 map）。
- **Step 7｜taxonomy QA 拡張**
  `scripts/diagnosis-taxonomy-qa.ts` を 9タイプ含めて拡張（番号系 1-4 と文字列系 9 が衝突しないこと、各 source の feedback テーブルが網羅されること）。
- **Step 8｜段階開放（切替の唯一地点）**
  feature flag を内部 ON → 観測（mirror_events / Tutor section の hint 出力）→ 全開放。問題時は flag OFF で即 4タイプへロールバック。
- **Step 9｜ドキュメント更新**
  `docs/diagnosis/`（current_state / steps）/ `docs/supabase/diagnosis_*` / `docs/release/freeze.md` を更新。legacy 4タイプは「凍結併存」と明記。

---

## 8. リスク一覧

| # | リスク | 重大度 | 内容 / 対策 |
|---|---|---|---|
| R1 | **`DiagnosisType` 共有破壊** | **高** | `types/diagnosis.ts` を 9タイプ化すると self-analysis(`inferAnalysisType`)・mypage・feedback の番号系が全崩壊。→ **触らず `ExamType` 新設**。 |
| R2 | **Option B 違反（scoreVector 保存）** | **高** | juken `saveDiagnosis`/`diagnosisProfile` を移植すると DB に scoreVector 保存。→ 移植せず answers 保存 + 再計算。 |
| R3 | Tutor の無言スキップ | 中 | `loadDiagnosisContext` の `typeof===number` ガードで string resultType が hint 無しに。→ 分岐追加。 |
| R4 | home カードの reject | 中 | `isResultUsable` の `t!==1..4` で 9タイプ結果が PromoCard 落ち。→ 系統別ガード。 |
| R5 | SCHEMA_VERSION 二重管理 drift | 中 | `mirrorDiagnosis.ts` と `diagnosisLogs.ts` に同名定数が独立存在。**同時 bump 必須**（コメントに警告あり）。 |
| R6 | mypage 文字列直描画 | 中 | `タイプ {applicantType}` が「タイプ riaju」化。→ ラベル map。 |
| R7 | 配点モデル取り違え | 中 | PASSAI 面積方式の maxPossible を juken データに適用すると正規化が歪む。→ juken の理論最大方式を使う。 |
| R8 | 推薦大学/NG生文の Tutor 漏れ | 中 | universities / badExamples を hint に入れると断定的進路誘導・人格断定に。→ strategy/ngBehavior の言い換えのみ。 |
| R9 | 既存 LS/mirror データ互換 | 低 | 保存キー分離 + payload number/string 両対応で migration 不要。 |
| R10 | プロンプト hash 安定性 | 低 | Tutor hint 文言変更で `lib/hash/tutor.ts` v bump 検討。キャッシュ無効化のみで品質中立。 |

---

## 9. 実装時の注意点（チェックリスト）

- [ ] `types/diagnosis.ts:DiagnosisType` は **絶対に変更しない**（self-analysis と共有）。9タイプは新ファイル。
- [ ] juken の **DB 永続層（saveDiagnosis / diagnosisProfile / diagnosisStorage の DB 部 / exam_diagnosis_* テーブル）は移植しない**。`score_vector` は保存しない。
- [ ] 9タイプ保存は **answers のみ**。resultType / secondaryType / scoreVector は表示・hint 時に `computeScoreVector(answers)` で再計算（Option B）。
- [ ] `maxPossible` は **juken の理論最大方式**（重み付き前提）。PASSAI 4タイプの面積方式を流用しない。
- [ ] `mirrorDiagnosis.ts` と `diagnosisLogs.ts` の `SCHEMA_VERSION` を **同時に** bump（`2→3`）。
- [ ] `loadDiagnosisContext` / `isResultUsable` / mypage 描画を **number(旧) / string(新) 両対応**に。文字列を無言で落とさない。
- [ ] Tutor へは **タイプ名・score・raw JSON・推薦大学・NG生文を渡さない**。strategy/ngBehavior の言い換え hint のみ。
- [ ] 切替は **feature flag 1 点**に集約し、OFF で 4タイプへ即ロールバック可能に。
- [ ] `scripts/diagnosis-scoring-qa.ts` / `diagnosis-taxonomy-qa.ts` は実 AI 呼び出し無しの純ロジック QA。**API コスト承認不要**で先行実行可。
- [ ] legacy（4タイプ scoring / RESULT_TYPES / DIAGNOSIS_FEEDBACK / 1-4 hints / 4タイプ QA）を残し green を維持。

---

*この文書は設計・監査のみ。コード変更は未実施。*
