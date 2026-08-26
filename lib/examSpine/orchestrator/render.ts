// PASSAI 受験版 Exam Spine — Layer 5 render（Stage 2 / 純関数のみ）。
//
// 責務は「並べ終わった block を 1 本の文字列にする」ことだけ。
// どの block を載せるか（Layer 3）も、どの順で並べるか（Layer 4）もここでは決めない。
//
// ★ Stage 2 の制約 ★
//   - `.trim()` / `.filter(Boolean)` / `.join('\n\n')` を「だいたい同じだから」で共通化しない。
//     legacy が実際にやっている操作だけを render contract の宣言から再現する。
//   - content を勝手に normalize しない。空白・改行・全角記号は legacy のまま通す。
//   - budget を見て truncate / drop しない（Stage 2 は budget を enforce しない）。
//
// 純関数（I/O / AI / Date / Math.random 一切なし）。

import type { ExamContextBlock } from '../blocks/types';
import type { ExamBlockSlot, ExamRenderContract } from './plan';

/** slot（どう出すか）と block（何を出すか）の対。Layer 4 の出力。 */
export type ExamOrderedBlock = {
  slot: ExamBlockSlot;
  block: ExamContextBlock;
};

export type ExamRenderResult = {
  text: string;
  /** 空 / missing のため出力から落ちた block id。 */
  omitted: readonly ExamOrderedBlock['block']['id'][];
};

/**
 * 並び終わった block を render contract に従って 1 本の文字列にする（Layer 5）。
 *
 * 空判定は **content（heading を付ける前）** に対して行う。legacy 側も
 * `if (uniContextSection)` / `cond ? \`heading\nbody\` : ''` のように content 条件で
 * section の有無を決めているため、composed 文字列で判定すると挙動がずれる。
 */
export function renderExamContext(
  contract: ExamRenderContract,
  ordered: readonly ExamOrderedBlock[],
): ExamRenderResult {
  const parts: string[] = [];
  const omitted: ExamOrderedBlock['block']['id'][] = [];

  for (const { slot, block } of ordered) {
    // legacy が trim してから空判定している slot だけ trim する。
    const raw = slot.trim ? block.content.trim() : block.content;
    const isEmpty = contract.dropEmpty === 'blank' ? raw.trim() === '' : raw === '';

    let body: string;
    if (!isEmpty) {
      body = raw;
    } else if (slot.placeholder !== undefined) {
      // placeholder が '' の slot は「本文は空だが heading は必ず出す」を表す。
      body = slot.placeholder;
    } else {
      omitted.push(block.id);
      continue;
    }

    const headed = slot.heading === undefined ? body : `${slot.heading}\n${body}`;
    parts.push(slot.suffix === undefined ? headed : `${headed}${slot.suffix}`);
  }

  const bodyText = parts.join(contract.separator);
  const text = [...contract.preamble, bodyText, ...contract.postamble].join(contract.joiner);

  return {
    text: contract.trailingNewline ? `${text}\n` : text,
    omitted,
  };
}
