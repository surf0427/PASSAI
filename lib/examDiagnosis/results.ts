// 受験タイプ診断（9タイプ）の結果コンテンツ。
// 移植元: juken-shindan/data/results.ts（content verbatim、import path のみ変更）。
// 表示（結果画面）専用。Tutor へは name / universities / badExamples / ngExplanation の
// 生文を渡さない（lib/contextBuilders/tutorContext.ts の hint へ言い換える）。

import type { ExamResult } from '@/types/examDiagnosis';

export const EXAM_RESULTS: ExamResult[] = [
  {
    type: 'riaju',
    name: 'リア充タイプ',
    catchphrase: '環境と人で伸びるタイプ',
    description:
      '人との関わりや雰囲気によってモチベーションが大きく変わる。一人で黙々というより、「誰とやるか」「どんな空気か」で実力が伸びるタイプ。受験でも、友達やコミュニティをうまく活用すると一気に伸びる。逆に孤独な環境だとポテンシャルを発揮しきれない。',
    strategy: '人・環境を味方につけろ',
    universities: ['青山学院大学', '立教大学', '関西学院大学'],
    universityCharacter: 'おしゃれ都会キャンパス陽キャ文化',
    reason: '都心にキャンパスがあり、社交的でアクティブな学生文化。サークル・イベント・人とのつながりを楽しめる環境。',
    ngBehavior: '環境任せで流されること',
    ngExplanation: '周りの雰囲気に合わせすぎて、受験の軸がなくなる。「みんながやってるから」で動くと一気に弱くなる。',
    badExamples: ['友達が受ける大学をなんとなく選ぶ', '楽そうな方向に流れる'],
    countermeasure: '自分の目的を1つ決めてから動け',
  },
  {
    type: 'yutosei',
    name: '優等生タイプ',
    catchphrase: '最短ルートで結果を出す戦略家',
    description:
      'ゴールから逆算して動けるタイプ。努力の方向を間違えず、効率よく成果を出すのが得意。評価・実績・ブランドに対する意識も高く、受験でも「勝ちに行く選択」ができる。',
    strategy: '正しい努力を積み上げろ',
    universities: ['慶應義塾大学', '一橋大学', '神戸大学'],
    universityCharacter: 'ビジネス・人脈・エリート志向',
    reason: '実学志向が強く、ビジネスや社会で成功する人材を多く輩出。インターンや起業など実践活動が盛ん。',
    ngBehavior: '正解にこだわりすぎること',
    ngExplanation: '「これが正しいルート」という思い込みで動くと、個性や独自性が消えて評価が伸びない。',
    badExamples: ['テンプレ通りの志望理由書', '安全すぎる選択ばかりする'],
    countermeasure: 'あえて"ズラす勇気"を持て',
  },
  {
    type: 'jiyujin',
    name: '自由人タイプ',
    catchphrase: '型にハマらない発想型プレイヤー',
    description:
      '決められたレールより、自分なりのやり方で成果を出すタイプ。興味があることには爆発的に伸びるが、縛られると一気に失速する。受験でも「自分の軸」を持てば強い。逆に周りに流されると迷走しやすい。',
    strategy: '自分の面白さを武器にしろ',
    universities: ['早稲田大学', '同志社大学', '明治大学'],
    universityCharacter: '自由で多様な学生文化',
    reason: '色んなタイプの学生がいて、自由な雰囲気。面白い活動や個性を活かした学生生活ができる。',
    ngBehavior: '気分で動きすぎること',
    ngExplanation: '興味があることだけやって、継続できない。結果、どれも中途半端になる。',
    badExamples: ['途中で志望校や方向性をコロコロ変える', '締切ギリギリで焦る'],
    countermeasure: '最低限のルールを自分に課せ',
  },
  {
    type: 'kyoyo',
    name: '教養タイプ',
    catchphrase: '考える力で勝つ知性型',
    description:
      '暗記だけでなく、「なぜ？」を深く考えるのが得意。論理力・言語化力に強みがある。総合型・小論文・面接などで真価を発揮するタイプ。表面的な対策だけだと逆に伸びない。',
    strategy: '思考の深さで差をつけろ',
    universities: ['国際基督教大学', '国際教養大学', '法政大学'],
    universityCharacter: '少人数教育・議論中心の知的環境',
    reason: '幅広い分野を学びながら思考力を鍛える教育。ディスカッション型授業が多い。',
    ngBehavior: '考えすぎて行動しないこと',
    ngExplanation: '深く考えるのは強みだけど、アウトプットしないと評価されない。',
    badExamples: ['準備に時間をかけすぎる', '「まだ完成してない」で出さない'],
    countermeasure: '6割でいいから出せ',
  },
  {
    type: 'kaigai',
    name: '海外思考タイプ',
    catchphrase: '外の世界を基準にするグローバル型',
    description:
      '日本だけでなく、世界基準で物事を考えられるタイプ。語学・文化・多様性への興味が強い。受験でも「なぜその大学か」を広い視点で語れるのが強み。逆に内向きな理由だと弱くなる。',
    strategy: '視野の広さで戦え',
    universities: ['上智大学', '立命館アジア太平洋大学', '関西外国語大学'],
    universityCharacter: '国際交流・多文化環境',
    reason: '留学生が多く、海外志向の学生文化。語学・国際関係に興味がある人に向いている。',
    ngBehavior: '理想だけで語ること',
    ngExplanation: 'グローバルな話ばかりで、「じゃああなたは何をしてきたの？」が弱くなる。',
    badExamples: ['抽象的な志望理由', '海外行きたいだけで終わる'],
    countermeasure: '必ず"自分の経験"とセットで語れ',
  },
  {
    type: 'challenger',
    name: 'チャレンジャータイプ',
    catchphrase: '未知に挑む開拓者',
    description:
      '新しいことや難しいことにワクワクできるタイプ。正解がない状況でも動ける。受験でも「前例のない挑戦」や「独自のストーリー」で強い。無難にまとめると逆に埋もれる。',
    strategy: '挑戦の質で勝負しろ',
    universities: ['筑波大学', '横浜国立大学', '千葉大学'],
    universityCharacter: '分野横断・新しい挑戦ができる',
    reason: '複数分野を組み合わせた研究や教育。新しいことに挑戦する学生が多い。',
    ngBehavior: '挑戦だけで終わること',
    ngExplanation: '新しいことはやるけど、成果や継続が弱いと評価されない。',
    badExamples: ['いろんなことに手を出すだけ', '深掘りがない'],
    countermeasure: '1つでいいから結果を出せ',
  },
  {
    type: 'gariben',
    name: 'ガリ勉タイプ',
    catchphrase: '努力で圧倒する職人型',
    description:
      'コツコツ積み上げる力が圧倒的。量と質の両方で勝てるタイプ。派手さはなくても、最終的に一番強いのがこのタイプ。ただし方向を間違えると非効率になる。',
    strategy: '正しい努力を継続しろ',
    universities: ['東京理科大学', '豊田工業大学', '電気通信大学'],
    universityCharacter: 'ストイック研究・実力主義',
    reason: '勉強量が多く、研究志向の学生文化。理系・専門分野を深く学びたい人向け。',
    ngBehavior: '努力の方向を間違えること',
    ngExplanation: '頑張る力はあるけど、ズレた努力をすると時間を無駄にする。',
    badExamples: ['必要ないことまでやり込む', '効率を無視する'],
    countermeasure: '常に「これ意味ある？」と考えろ',
  },
  {
    type: 'kakumeika',
    name: '革命家タイプ',
    catchphrase: '社会を変えたい問題提起型',
    description:
      '現状に疑問を持ち、「変えたい」と思えるタイプ。社会課題・政治・教育などへの関心が強い。受験でも「問題意識の深さ」が最大の武器。浅い正義感だと逆に弱い。',
    strategy: '本気の問題意識を言語化しろ',
    universities: ['立命館大学', '法政大学', '中央大学'],
    universityCharacter: '社会問題・政策志向',
    reason: '社会問題や政治、政策に関心が高い学生が多い。社会活動や議論が盛んな大学。',
    ngBehavior: '浅い正義感で語ること',
    ngExplanation: '「社会を変えたい」だけでは弱い。具体性とリアリティがないと評価されない。',
    badExamples: ['ニュースの受け売り', '感情だけの主張'],
    countermeasure: '自分の体験ベースで語れ',
  },
  {
    type: 'creator',
    name: 'クリエイタータイプ',
    catchphrase: '表現で勝つアウトプット型',
    description:
      '頭の中のイメージを形にする力がある。言葉・デザイン・映像などで自分を表現できるタイプ。受験でも「伝え方」で差をつけられる。ただし中身が薄いと一瞬で見抜かれる。',
    strategy: '表現力と中身を両立させろ',
    universities: ['武蔵野美術大学', '多摩美術大学', '京都芸術大学'],
    universityCharacter: '制作中心・表現重視',
    reason: 'デザイン・アート・映像など創作活動が中心。自分の作品を作りながら学べる環境。',
    ngBehavior: '雰囲気だけで勝負すること',
    ngExplanation: '見た目や表現は良くても、中身が薄いと一瞬で見抜かれる。',
    badExamples: ['カッコいい言葉だけ並べる', '内容が具体的でない'],
    countermeasure: '中身→表現の順で作れ',
  },
];

// type → ExamResult の lookup（O(1)）。表示・hint 構築で再利用。
const RESULT_BY_TYPE = Object.fromEntries(
  EXAM_RESULTS.map((r) => [r.type, r]),
) as Record<ExamResult['type'], ExamResult>;

export function getExamResult(type: ExamResult['type']): ExamResult {
  return RESULT_BY_TYPE[type];
}
