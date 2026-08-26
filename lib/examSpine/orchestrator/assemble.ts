// PASSAI 受験版 Exam Spine — Layer 3 / 4 と pipeline entry（Stage 2 / 純関数のみ）。
//
//   buildExamContextBlocks()      Layer 2  … blocks/build.ts
//   selectExamContextBlocks()     Layer 3  … purpose policy による選択
//   orderExamContextBlocks()      Layer 4  … purpose ごとの順序
//   renderExamContext()           Layer 5  … orchestrator/render.ts
//   assembleExamContext()         上記を繋ぐ entry
//
// ★ production wiring はしない。Stage 2 では誰もこの entry を呼ばない
//   （呼ぶのは scripts/exam-spine-stage2-check.ts だけ）。
//
// 純関数（I/O / AI / Date / Math.random / env 一切なし）。

import type { ExamContextPurpose } from '../types';
import { EXAM_CONTEXT_BUDGETS } from '../budget';
import type { ExamContextBlock, ExamContextBlockId } from '../blocks/types';
import { buildExamContextBlocks } from '../blocks/build';
import type { ExamContextInput } from './input';
import { getExamPurposePlan } from './plan';
import type { ExamBlockSlot } from './plan';
import { renderExamContext } from './render';
import type { ExamOrderedBlock } from './render';

export type { ExamOrderedBlock } from './render';

// ── Layer 3: selection ────────────────────────────────────────────────

export type ExamBlockSelection = {
  /** purpose plan が要求した block（宣言順のまま）。 */
  selected: readonly ExamOrderedBlock[];
  /** purpose が使わない block id（= policy による除外）。 */
  excluded: readonly ExamContextBlockId[];
};

/**
 * purpose policy に従って block を選ぶ（Layer 3）。
 *
 * ★ route ごとの if 文を書かない。何を選ぶかは purpose plan の宣言だけで決まる。
 *   plan に無い block は「この purpose では使わない」であり、空だから落ちたのとは別物
 *   （§Empty / Missing semantics の "excluded by purpose"）。
 */
export function selectExamContextBlocks(
  purpose: ExamContextPurpose,
  blocks: readonly ExamContextBlock[],
): ExamBlockSelection {
  const plan = getExamPurposePlan(purpose);
  const byId = new Map<ExamContextBlockId, ExamContextBlock>();
  for (const block of blocks) byId.set(block.id, block);

  const selected: ExamOrderedBlock[] = [];
  const wanted = new Set<ExamContextBlockId>();
  for (const slot of plan.blocks) {
    wanted.add(slot.id);
    const block = byId.get(slot.id);
    // block は全 id 分作られる契約なので、欠けるのは呼び出し側のミス。
    // Stage 2 では throw せず、欠落を excluded に落とさず単に飛ばす（QA が検出する）。
    if (block) selected.push({ slot, block });
  }

  const excluded = blocks.map((b) => b.id).filter((id) => !wanted.has(id));
  return { selected, excluded };
}

// ── Layer 4: ordering ─────────────────────────────────────────────────

/**
 * purpose ごとの順序を確定する（Layer 4）。
 *
 * 順序の正本は purpose plan の宣言順 1 つだけにしてある。selection と ordering で
 * 別々の配列を持つと 2 箇所が食い違うため、ordering は selection の順序を
 * plan の宣言順へ揃え直す（= plan が唯一の順序定義）。
 */
export function orderExamContextBlocks(
  purpose: ExamContextPurpose,
  selected: readonly ExamOrderedBlock[],
): readonly ExamOrderedBlock[] {
  const plan = getExamPurposePlan(purpose);
  const order = new Map<ExamBlockSlot, number>();
  plan.blocks.forEach((slot, i) => order.set(slot, i));
  return [...selected].sort(
    (a, b) => (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0),
  );
}

// ── Entry ─────────────────────────────────────────────────────────────

export type ExamContextAssembly = {
  purpose: ExamContextPurpose;
  /** Layer 2 の全 block（観測用。選ばれなかったものも含む）。 */
  blocks: readonly ExamContextBlock[];
  /** Layer 4 の出力。 */
  ordered: readonly ExamOrderedBlock[];
  /** purpose policy が使わない block id。 */
  excluded: readonly ExamContextBlockId[];
  /** 選ばれたが空 / missing で出力から落ちた block id。 */
  omitted: readonly ExamContextBlockId[];
  /**
   * 'no_render_contract' … Stage 2 で byte 検証済みの render contract を持たない purpose。
   * 推測で文字列を作らず text を null にする（無理に mock して PASS にしない）。
   */
  renderStatus: 'rendered' | 'no_render_contract';
  text: string | null;
  estimatedChars: number;
  /**
   * budget metadata。**参照のみ**で、truncate / slice / summarize / drop は一切しない。
   * Stage 1 で大半が observed_only（実測値であって enforcement contract ではない）であり、
   * Stage 2 で enforce すると byte-equivalence が壊れるため。
   */
  budget: {
    maxContextChars: number;
    basis: 'code_enforced' | 'observed_only';
    enforced: false;
  };
};

/**
 * Exam Spine Stage 2 の pure pipeline entry。
 *
 *   input → buildExamContextBlocks → selectExamContextBlocks
 *         → orderExamContextBlocks → renderExamContext → text
 */
export function assembleExamContext(args: {
  purpose: ExamContextPurpose;
  input: ExamContextInput;
}): ExamContextAssembly {
  const { purpose, input } = args;
  const plan = getExamPurposePlan(purpose);
  const budget = EXAM_CONTEXT_BUDGETS[purpose];

  const blocks = buildExamContextBlocks(input);
  const { selected, excluded } = selectExamContextBlocks(purpose, blocks);
  const ordered = orderExamContextBlocks(purpose, selected);

  if (!plan.render) {
    return {
      purpose,
      blocks,
      ordered,
      excluded,
      omitted: ordered.filter((o) => o.block.empty).map((o) => o.block.id),
      renderStatus: 'no_render_contract',
      text: null,
      estimatedChars: 0,
      budget: {
        maxContextChars: budget.maxContextChars,
        basis: budget.basis,
        enforced: false,
      },
    };
  }

  const rendered = renderExamContext(plan.render, ordered);
  return {
    purpose,
    blocks,
    ordered,
    excluded,
    omitted: rendered.omitted,
    renderStatus: 'rendered',
    text: rendered.text,
    estimatedChars: rendered.text.length,
    budget: {
      maxContextChars: budget.maxContextChars,
      basis: budget.basis,
      enforced: false,
    },
  };
}
