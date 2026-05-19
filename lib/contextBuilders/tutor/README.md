# Tutor Context Builders

PASSAI 受験チューターAI（`app/api/tutor`、実装予定）が AI に渡す runtime context を、
純粋関数で組み立てる層。

関連:
- [lib/tutor/types.ts](../../tutor/types.ts) — `TutorIntent` / `PreferredProfileField`
- [lib/tutor/tutorPrompt.ts](../../tutor/tutorPrompt.ts) — `TUTOR_SYSTEM_PROMPT`
- [lib/aiInputHash.ts](../../aiInputHash.ts) — `TUTOR_PROMPT_VERSION`
- [docs/principles/student_profile_contract.md](../../../docs/principles/student_profile_contract.md)
- [lib/contextBuilders/README.md](../README.md) — 上位レイヤの規約

---

## 1. 責務

- 入力（StudentProfile / basicInfo / statementDraft / 等）を AI prompt 用の中間 context string に整形する
- 1 source = 1 builder の責務分離（複数 source の merge は主 entry でのみ行う）
- intent に応じた section 合成（`buildTutorPromptContext`）
- 入力欠損・型不一致を defensive に吸収（throw せず空文字を返す）

責務外:
- localStorage / Supabase / storage helper の直接読み（呼び出し側が provide）
- AI 呼び出し
- prompt 文言の組み立て（その責務は `lib/tutor/tutorPrompt.ts`）
- 履歴の保持（毎ターン「初対面」原則、latest 1 件のみ受け取る）

---

## 2. 純粋関数原則

各 builder は次を厳守する。

- AI 呼び出ししない
- `fetch` / network 通信しない
- `localStorage` / Supabase / storage helper を読まない
- `Date.now()` / `new Date()` / `Math.random()` を使わない
- `console.*` を使わない
- 副作用（write / log / global mutation）を起こさない
- 同入力に対して同出力を返す（deterministic）
- 入力欠損・型不一致時は `throw` せず空文字 `""` を返す

---

## 3. 含めるもの

| builder | 含める field |
|---|---|
| `buildTutorBasicInfoSection` | grade / track / preferences[0].(university,faculty) / examTypes[0] |
| `buildTutorStudentProfileContext` | summary / strengths or weaknesses（1 件）/ futureConnections（general or statement 時のみ 1 件）/ valueKeywords（上位 3 件） |
| `buildTutorStatementContext` | university/faculty/department（1 行）/ statementText 冒頭（100 字）/ weakPoints[0] or improvements[0]（1 件） |
| `buildTutorInterviewContext` | questionsAndAnswers[0].question 冒頭（60 字）/ answer 冒頭（80 字）/ improvements[0] |
| `buildTutorSelfAnalysisContext` | questions[0] / answers[0] 冒頭（80 字） |
| `buildTutorSelfPrContext` | selfPRDraft 冒頭（100 字） |
| `buildTutorStabilizationContext` | basicInfo compact + StudentProfile.summary のみ |

---

## 4. 含めないもの（絶対禁止）

すべての builder で以下を出力に含めない。

- 日付・時刻（`generatedAt` / `updated_at` / timestamp 系）
- 配列インデックス・配列長（「strengths[0]」「全 12 件中」など）
- 数値スコア（`totalScore` / `breakdown.scores` / 偏差値 / 評定値）
- `subjectGrades` の評定値・欠席日数（既存 SUBJECT_GRADES_ASYMMETRY_RULE 規約継承）
- `applicantType` ラベル名（「活動実績型」等）
- 志望理由書・自己PR・小論文の全文（必ず冒頭抜粋）
- 履歴（`reviewHistory` / `interviewRecord` の 2 件目以降 / `additionalQuestions`）
- AI 出力（review feedback の全体 / `betterAnswer` / `followUpQuestions` / `levelEvaluation`）
- `name` / 個人特定情報

---

## 5. intent 別の合成ルール

`buildTutorPromptContext` で合成する。空文字 section は除外し `\n\n` で連結。

| intent | 構成 |
|---|---|
| `general` | basicInfo + studentProfile |
| `statement` | basicInfo + studentProfile + statementContext |
| `interview` | basicInfo + studentProfile + interviewContext |
| `self_analysis` | basicInfo + studentProfile + selfAnalysisContext |
| `selfpr` | basicInfo + studentProfile + selfPrContext |
| `stabilize` | stabilizationContext のみ（basicInfo + summary） |

userMessage はここに含めない（route 側で末尾に付ける）。

---

## 6. preferredProfileField

`buildTutorStudentProfileContext` は前回引いた要素と違う field を引くため、
呼び出し側が `preferredProfileField: 'strengths' | 'weaknesses'` を指定できる。

- 指定なし → default `'strengths'`
- 指定 field が空配列なら、もう一方を fallback として 1 件試す
- `strengths` と `weaknesses` を **同時には出さない**（1 件のみ）

---

## 7. truncation 定数

各上限長は [`types.ts`](./types.ts) に集約。

| 定数 | 値 |
|---|---|
| `MAX_STATEMENT_EXCERPT_LENGTH` | 100 |
| `MAX_INTERVIEW_QUESTION_LENGTH` | 60 |
| `MAX_INTERVIEW_ANSWER_LENGTH` | 80 |
| `MAX_SELF_ANALYSIS_ANSWER_LENGTH` | 80 |
| `MAX_SELF_PR_EXCERPT_LENGTH` | 100 |
| `MAX_PROFILE_ITEM_LENGTH` | 60 |
| `MAX_FUTURE_CONNECTION_LENGTH` | 80 |
| `MAX_VALUE_KEYWORDS` | 3 |

超過時は省略記号なしで `slice(0, max)` する（自然な位置で切れる）。

---

## 8. 出力例

`intent='statement'` の場合の合成例:

```
【受験生の基本情報】
高3 / 文系
第一志望: ○○大学 / ××学部
受験方式: 総合型選抜

【自己分析サマリー】
中学から続けてきた地域活動を通じて...
強み: 試行錯誤を繰り返しながら仮説を立て直す粘り強さ
将来の方向: 地域医療に貢献する仕事に就きたい
価値観キーワード: 継続力 / 課題解決 / 行動力

【志望理由書の現状】
大学・学部: ○○大学 / ××学部 / 地域医療学科
書いてある内容の冒頭: 私が貴学を志望する理由は、地域医療に関心を持ち...
直近の添削で出た弱み: 志望動機と将来像の接続が抽象的な印象です
```

`intent='stabilize'` の場合:

```
【受験生の基本情報】
高3 / 文系
第一志望: ○○大学 / ××学部
受験方式: 総合型選抜

【自己分析サマリー】
中学から続けてきた地域活動を通じて...
```
