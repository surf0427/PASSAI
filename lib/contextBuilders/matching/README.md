# matching context builder（実装あり・現状は flat 配置）

志望校マッチング向けの context builder の future home。**現時点では実体は flat 配置**:
[`../matchingContext.ts`](../matchingContext.ts) → `buildMatchingStudentProfileContext()`

## 現状

- `buildMatchingStudentProfileContext(profile: StudentProfile | null): string` が稼働中
- 含めているもの: summary 全文 / strengths（上位5） / weaknesses（上位2） / futureConnections（上位3） / valueKeywords（上位8） / signatureEpisodes（上位3）
- 自己分析の幅広い側面を見るため他の builder より多めに使う
- format: multi-line bullets で視認性優先

## 将来の責務（migrate 後）

- 既存の人格 context に加えて、matching 固有の素材を集約:
  - admission style（一般 / 総合型 / 学校推薦 等の傾向整理）
  - scoring factors（matching スコアの根拠素材）
  - recommendation basis（「なぜこの大学を勧めるか」の AI 説明用素材）

## migrate trigger

- matching family の context builder が 2 つ目追加された時
- もしくは [`incremental_refactor_policy.md §T5`](../../../docs/principles/incremental_refactor_policy.md)（`contextBuilders/universityDb/` 集約）の trigger と抱き合わせ可能になった時
- それまでは flat ファイルを維持。`app/api/matching/route.ts` も含め import 書き換えを起こさない
