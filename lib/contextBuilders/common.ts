// context builder layer の共通フォーマッタ。
//
// 配置方針:
//   ここには「上位 N 件を箇条書きにする」程度の、すべての context builder で重複していた
//   微小な整形だけ置く。「セクション全体の組み立て」「feature 用最適化の判断」は各
//   context builder ファイルに残し、ここに引き上げない（抽象化のための抽象化を避ける）。
//
// 関連: lib/contextBuilders/<feature>Context.ts

// 上位 N 件を「・xxx<joiner>・yyy」形式にする。
// statement は inline 形式（`・a ・b ・c`）で読みやすさを優先、
// interview / matching は multi-line 形式（`・a\n・b\n・c`）で視認性を優先するため、
// joiner だけ feature 側で切り替える。
export function formatBulletList(
  items: string[],
  max: number,
  joiner: '\n' | ' ' = '\n',
): string {
  return items.slice(0, max).map((s) => `・${s}`).join(joiner);
}

// 上位 N 件を区切り文字でつなぐ（valueKeywords のような inline tag 用）。
export function formatInlineList(
  items: string[],
  max: number,
  separator = ' / ',
): string {
  return items.slice(0, max).join(separator);
}
