// 受験タイプの「分析コメント」表示文言の単一情報源。
//
// 重要（R12 タクソノミー衝突対策）:
//   DiagnosisType（1|2|3|4）という同じ番号が、来歴によって別の意味を持つ。
//     - self-analysis 由来（lib/analysis/inferAnalysisType.ts）:
//         1 活動アピール / 2 探究・研究 / 3 将来ビジョン / 4 成長ポテンシャル
//         → TYPE_FEEDBACK を参照。
//     - /diagnosis 由来（passai_diagnosis_result の resultType。
//       app/diagnosis/page.tsx の RESULT_TYPES と意味を一致させる）:
//         1 整理 / 2 言語化 / 3 書類完成度 / 4 一般受験並行
//         → DIAGNOSIS_FEEDBACK を参照。
//   番号が同じでも意味が違うため、番号変換ではなく「表示定義そのものを来歴で
//   出し分ける」（Option B）。描画側（DiagnosisTypeCard）は resolved.source で
//   どちらのテーブルを使うか決める。保存形式（resultType の数値）には触れない。
//
// この 2 テーブルの番号→意味の対応は scripts/diagnosis-taxonomy-qa.ts で検証する。

import type { DiagnosisType } from '@/types/diagnosis';
import type { ExamType } from '@/types/examDiagnosis';

export type Feedback = {
  summary: string;
  strengths: string;
  caution: string;
  nextStep: string;
  ctaHref: string;
  ctaLabel: string;
};

// self-analysis summary 由来（inferAnalysisType）のタイプ用フィードバック。
//   1 活動アピール / 2 探究・研究 / 3 将来ビジョン / 4 成長ポテンシャル
export const TYPE_FEEDBACK: Record<DiagnosisType, Feedback> = {
  1: {
    summary: '今回の内容からは、「活動アピール型」に近い特徴が見えます。',
    strengths:
      '経験や行動を材料にしやすく、面接や志望理由書でも具体例を出しやすい点が強みとして見えます。',
    caution:
      '一方で、活動の説明だけで終わらず、そこから何を学んだか・大学での学びにどうつなげるかまで整理できると、さらに説得力が増していきます。',
    nextStep: '次は「活動整理」で材料を深めていくのがおすすめです。',
    ctaHref: '/input/activity',
    ctaLabel: '活動整理を進める',
  },
  2: {
    summary: '今回の内容からは、「探究・研究型」に近い特徴が見えます。',
    strengths:
      '問題意識や興味関心を軸にしやすく、学部・学科との相性を示しやすい点が強みとして見えます。',
    caution:
      '一方で、興味が抽象的なままだと弱く見えやすいので、調べたこと・考えたことを具体化していくと、より深さが伝わります。',
    nextStep:
      '次は「自己分析」で「なぜ学びたいか」を言語化していくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
  3: {
    summary: '今回の内容からは、「将来ビジョン型」に近い特徴が見えます。',
    strengths:
      '志望理由に一貫性を出しやすく、将来像から逆算して話を組み立てられる点が強みとして見えます。',
    caution:
      '一方で、将来の夢だけで終わらせず、きっかけや根拠を具体化し、大学での学びとの接続を明確にしていくと、さらに説得力が増します。',
    nextStep:
      '次は「志望理由書」で将来像と大学での学びをつなげていくのがおすすめです。',
    ctaHref: '/statement',
    ctaLabel: '志望理由書に進む',
  },
  4: {
    summary: '今回の内容からは、「成長ポテンシャル型」に近い特徴が見えます。',
    strengths:
      '変化や努力の過程を材料にしやすく、これから伸びる理由を伝えやすい点が強みとして見えます。',
    caution:
      '一方で、「頑張ります」だけで終わらせず、過去の変化や行動を具体化し、今後の挑戦を大学での学びにつなげていくと、より説得力が増します。',
    nextStep:
      '次は「自己分析」で変化や伸びしろを言葉にしていくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
};

// /diagnosis（passai_diagnosis_result）由来のタイプ用フィードバック。
// 番号の意味は app/diagnosis/page.tsx の RESULT_TYPES と一致させる:
//   1 整理 / 2 言語化 / 3 書類完成度 / 4 一般受験並行。
// inferAnalysisType 用の TYPE_FEEDBACK とは別タクソノミーなので混ぜない。
export const DIAGNOSIS_FEEDBACK: Record<DiagnosisType, Feedback> = {
  1: {
    summary: '受験タイプ診断の結果は「何から始めるか整理タイプ」でした。',
    strengths:
      '今は実績が足りないのではなく、これまでの経験をどう言葉にするかが見えていない状態です。まず材料を棚卸しすれば一気に進めやすくなります。',
    caution:
      '一方で、最初から完璧な志望理由書を目指すと手が止まりやすいので、まずは活動整理と自己分析で材料を集めることから始めるのがおすすめです。',
    nextStep: '次は「活動整理」から、経験を言葉にする材料を集めていきましょう。',
    ctaHref: '/input/activity',
    ctaLabel: '活動整理を進める',
  },
  2: {
    summary: '受験タイプ診断の結果は「経験言語化タイプ」でした。',
    strengths:
      '活動や経験はすでにあるので、それを志望理由書や面接で伝わる形に整理できれば強みになります。',
    caution:
      '一方で、経験を並べるだけでは伝わりにくいので、そこから何を学んだか・大学での学びにどうつなげるかまで言語化していくと説得力が増します。',
    nextStep:
      '次は「自己分析」で、経験を伝わる言葉に整理していくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
  3: {
    summary: '受験タイプ診断の結果は「書類完成度アップタイプ」でした。',
    strengths:
      'すでに書き始められているので、ここからは具体性・大学との一致・面接で話せる深さを高めていく段階です。',
    caution:
      '一方で、抽象的な表現が残っていると浅く見えやすいので、エピソードの具体化と大学での学びとの接続を意識して磨いていきましょう。',
    nextStep: '次は「志望理由書」で完成度を高めていくのがおすすめです。',
    ctaHref: '/statement',
    ctaLabel: '志望理由書に進む',
  },
  4: {
    summary: '受験タイプ診断の結果は「一般受験並行タイプ」でした。',
    strengths:
      '限られた時間で進める前提があるので、やることを絞って効率よくつなげられる点が強みになります。',
    caution:
      '一方で、あれもこれもと手を広げると共倒れしやすいので、活動整理・自己分析・志望理由書を最短ルートでつなげて進めるのがおすすめです。',
    nextStep:
      '次は「自己分析」から、限られた時間で材料を効率よく整理していきましょう。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
};

// /diagnosis 9タイプ版（ExamType 文字列 resultType）由来のタイプ用フィードバック。
// ⚠️ 番号系（DiagnosisType 1-4 = TYPE_FEEDBACK / DIAGNOSIS_FEEDBACK）とは別タクソノミー。
//   resultType が string のときだけ参照する（DiagnosisTypeCard が source で出し分け）。
// 内容は results.ts の各タイプ strategy / ngBehavior / countermeasure を、PASSAI の次の一歩
// （活動整理 / 自己分析 / 志望理由書）へつなぐコメントへ言い換えたもの。タイプ名の断定は避ける。
export const EXAM_DIAGNOSIS_FEEDBACK: Record<ExamType, Feedback> = {
  riaju: {
    summary: '受験タイプ診断からは、人や環境を活かして力を伸ばすタイプの傾向が見えます。',
    strengths:
      '周りの人や場の雰囲気をうまく使えるので、誰とどう進めるかを決めると一気に動きやすくなる点が強みです。',
    caution:
      '一方で、周りに合わせすぎると受験の軸がぶれやすいので、まず自分の目的を1つ言葉にしておくと流されにくくなります。',
    nextStep: '次は「自己分析」で、自分の軸を言葉にしていくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
  yutosei: {
    summary: '受験タイプ診断からは、ゴールから逆算して効率よく動けるタイプの傾向が見えます。',
    strengths:
      '努力の方向を見定めて成果につなげやすく、勝ちにいく選択ができる点が強みです。',
    caution:
      '一方で、正解のルートにこだわりすぎると独自性が薄くなりやすいので、あえて自分らしさを一段出していくと評価が伸びます。',
    nextStep: '次は「志望理由書」で、あなたならではの一貫性を形にしていくのがおすすめです。',
    ctaHref: '/statement',
    ctaLabel: '志望理由書に進む',
  },
  jiyujin: {
    summary: '受験タイプ診断からは、自分のやり方で力を発揮する発想型の傾向が見えます。',
    strengths:
      '興味があることには爆発的に伸び、自分の軸を持てたときに強い点が強みです。',
    caution:
      '一方で、気分で動くと続かず中途半端になりやすいので、最低限の進め方だけ決めておくと迷走を防げます。',
    nextStep: '次は「自己分析」で、自分の面白さを武器に変えていくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
  kyoyo: {
    summary: '受験タイプ診断からは、「なぜ？」を深く考えられる知性型の傾向が見えます。',
    strengths:
      '論理力・言語化力に強みがあり、小論文や面接で深さを出せる点が強みです。',
    caution:
      '一方で、考えすぎて出すのが遅れると評価につながりにくいので、6割でもまず形にして出すことを意識すると進みます。',
    nextStep: '次は「志望理由書」で、考えた深さを文章に落とし込んでいくのがおすすめです。',
    ctaHref: '/statement',
    ctaLabel: '志望理由書に進む',
  },
  kaigai: {
    summary: '受験タイプ診断からは、世界基準で物事を考えられるグローバル型の傾向が見えます。',
    strengths:
      '語学・文化・多様性への関心が強く、広い視点から志望理由を語れる点が強みです。',
    caution:
      '一方で、理想や抽象論だけだと弱く見えやすいので、必ず自分の経験とセットで語れるよう材料を整えておくと説得力が増します。',
    nextStep: '次は「活動整理」で、自分の経験を語れる材料に整えていくのがおすすめです。',
    ctaHref: '/input/activity',
    ctaLabel: '活動整理を進める',
  },
  challenger: {
    summary: '受験タイプ診断からは、未知に挑むのが得意な開拓者型の傾向が見えます。',
    strengths:
      '正解がない状況でも動け、独自のストーリーで勝負できる点が強みです。',
    caution:
      '一方で、挑戦が広がりすぎると成果が薄まりやすいので、1つに絞って結果まで深めると伝わりやすくなります。',
    nextStep: '次は「活動整理」で、挑戦を1つの成果として深めていくのがおすすめです。',
    ctaHref: '/input/activity',
    ctaLabel: '活動整理を進める',
  },
  gariben: {
    summary: '受験タイプ診断からは、コツコツ積み上げる努力型の傾向が見えます。',
    strengths:
      '量と質の両方で勝てる継続力があり、最終的に強さを発揮できる点が強みです。',
    caution:
      '一方で、努力の方向がずれると時間を無駄にしやすいので、「これは意味があるか」を時々確認しながら進めると効率的です。',
    nextStep: '次は「自己分析」で、努力を向ける方向を一緒に確かめていくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
  kakumeika: {
    summary: '受験タイプ診断からは、社会を変えたいという問題提起型の傾向が見えます。',
    strengths:
      '社会課題への関心が強く、問題意識の深さを武器にできる点が強みです。',
    caution:
      '一方で、浅い正義感や受け売りだと弱く見えやすいので、自分の体験に結びつけて具体化すると一気に伝わります。',
    nextStep: '次は「志望理由書」で、問題意識を自分の言葉で具体化していくのがおすすめです。',
    ctaHref: '/statement',
    ctaLabel: '志望理由書に進む',
  },
  creator: {
    summary: '受験タイプ診断からは、表現で伝えるのが得意なアウトプット型の傾向が見えます。',
    strengths:
      '頭の中のイメージを形にし、伝え方で差をつけられる点が強みです。',
    caution:
      '一方で、雰囲気だけだと中身の薄さが見抜かれやすいので、中身を先に固めてから表現する順番を意識すると説得力が増します。',
    nextStep: '次は「自己分析」で、伝えたい中身を先に整理していくのがおすすめです。',
    ctaHref: '/self-analysis',
    ctaLabel: '自己分析を進める',
  },
};

// currentHref が ctaHref と一致するときに nextStep を差し替える汎用文。
// /self-analysis 以外で再利用される可能性もあるため、ページ名を含めない言い回し。
export const SELF_REFERENCE_NEXT_STEP =
  '今このページで進めている内容を、引き続き丁寧に深めていくのがおすすめです。';
