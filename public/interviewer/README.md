# 面接官画像

AI 面接で表示する面接官の画像を置くディレクトリ。
参照は `lib/interviewAi/interviewerAvatar.ts` に集約しているため、差し替え時はここに画像を置くだけでよい。

## 必要なファイル（要追加）

| ファイル | 用途 | 使用モード |
| --- | --- | --- |
| `male.png` | 男性面接官（共通） | 自己分析 / 志望理由書 / 小論文 / 本番 |
| `pressure-female.png` | 女性面接官（圧迫専用） | 圧迫面接 |

## デザイン指針

- **男性面接官**: 20代後半〜30代前半、清潔感、紺色スーツ、優しい表情、威圧感なし、落ち着いた雰囲気。
- **女性面接官（圧迫）**: 小柄・可愛い系、スーツ、少し前のめり、ニヤッとした表情。圧迫感はあるが怖すぎない、エンタメ寄り。ホラー演出・過度な威圧は不要。

## 表示仕様

- カード表示（PC 約280px / スマホ 約220px）、`object-contain` で縦横比維持。
- 現行アートワークは 1402×1122（≒5:4 の横長・背景込み）。カード（`.iv-interviewer`）の `aspect-ratio` は
  この比率に合わせており、object-contain でも余白なくシーン全体が表示される。
- 比率の異なる画像（例: 縦長の透過 PNG）へ差し替える場合は、`globals.css` の `.iv-interviewer` の
  `aspect-ratio` をその画像比率に変更する（CLS を保つため固定値で指定）。
- 角丸・軽いシャドウはカード側 CSS（`.iv-interviewer`）で付与する。

## 将来拡張

表情差分（normal / smile / thinking / pressure）・口パク・瞬き・Live2D 化・TTS 連動アニメを追加する場合は
`interviewerAvatar.ts` の `InterviewerExpression` と `INTERVIEWER_IMAGES` を拡張する。
