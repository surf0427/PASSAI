# interview context builder（実装あり・現状は flat 配置）

面接フィードバック向けの context builder の future home。**現時点では実体は flat 配置**:
[`../interviewContext.ts`](../interviewContext.ts) → `buildInterviewStudentProfileContext()`

## 現状

- `buildInterviewStudentProfileContext(profile: StudentProfile | null): string` が稼働中
- 含めているもの: summary / strengths（上位3） / futureConnections（上位2） / valueKeywords（上位6） / signatureEpisodes（上位2）
- 除外: weaknesses（面接 prompt では混乱の元になる）
- format: multi-line bullets で視認性優先

## 将来の責務（migrate 後）

- 既存の人格 context に加えて、面接固有の素材を集約:
  - expected question focus（StudentProfile の strengths から想定質問の焦点を抽出）
  - weak points（面接時に弱点をどう語るかの素材。`weaknesses` を制御つきで取り込む可能性）
  - growth memo（過去の interview record から「成長の語り」を派生）

## migrate trigger

- 面接 family の context builder が 2 つ目追加された時（例: 質問生成側にも builder が必要になった時）
- それまでは flat ファイルを維持。import 書き換えコストを発生させない
- 既存 `app/api/interview-feedback/route.ts` の SYSTEM_PROMPT lift（[`incremental_refactor_policy.md §T2`](../../../docs/principles/incremental_refactor_policy.md)）と同 PR にできる場合は抱き合わせ検討
