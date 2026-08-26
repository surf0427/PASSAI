// PASSAI 受験版 Exam Spine — Stage 4 veto（純関数のみ）。
//
// Canon §18: 「読めたっぽいからとりあえず LLM へ渡す」を禁じる。
//
// ★ fail-open と veto の境界（Canon §5 / §41 / E-S1）★
//
//   fail-open が扱うもの ＝ **データが足りない**
//     source が空 / 読めなかった / verified にならなかった / block が無い
//     → その kind を使わずに続行する。context 全体は返す。**veto しない。**
//
//   veto が扱うもの ＝ **contract が壊れている**
//     purpose gate を通っていない kind が載っている / registry 外の table を読んだ /
//     provenance が欠けている / 認可されていない / identity を主張できない
//     → その context は渡してはいけない。blocks ごと落とす。
//
//   この境界を曖昧にすると 2 方向に壊れる:
//     veto を緩めると「検証できていないものを prompt に載せる」（Canon §18 違反）
//     veto を強めると「新規ユーザーには AI が一切使えない」（可用性の破壊 / E-S1 違反）

import { EXAM_SOURCE_TABLES } from '../sourceData/types';
import type { ExamSourceKind } from '../sourceData/types';
import type { ExamContextVeto, ExamSourceProvenance, ExamVetoReason } from './types';

const NO_VETO: ExamContextVeto = { vetoed: false };

export function noVeto(): ExamContextVeto {
  return NO_VETO;
}

export function vetoWith(reasons: readonly ExamVetoReason[]): ExamContextVeto {
  // 同じ理由を重複させない。順序は宣言順（重大な順）を保つ。
  const seen = new Set<ExamVetoReason>();
  const out: ExamVetoReason[] = [];
  for (const r of reasons) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out.length === 0 ? NO_VETO : { vetoed: true, reasons: out };
}

/**
 * 組み上がった context に対する不変条件チェック。
 *
 * ここで見るのは **assembler 自身のバグ / 契約違反**である。
 * 正常な fail-open（空・読めない・未検証）は 1 つも veto にしない。
 */
export function evaluateContextVeto(input: {
  readonly allowedSources: readonly ExamSourceKind[];
  readonly sources: readonly ExamSourceProvenance[];
  readonly readTables: readonly string[];
  readonly fingerprintAvailable: boolean;
}): ExamContextVeto {
  const reasons: ExamVetoReason[] = [];
  const allowed = new Set(input.allowedSources);

  // 1. purpose gate が漏れていないか（E-S28）。
  //
  //    ★ 判定材料は block の有無ではなく **read の痕跡** ★
  //      gate は「Spine が server から読んでよい kind」を決めるものであり、
  //      bridge 由来の値（legacy body 経路）を禁じるものではない。
  //      許可外 kind は reader が query を 1 本も出さないので state は
  //      必ず 'denied_by_purpose' になる。それ以外の state が付いていたら、
  //      read が実際に走った ＝ gate が漏れたということである。
  const leaked = input.sources.filter(
    (s) => !allowed.has(s.kind) && s.state !== 'denied_by_purpose',
  );
  if (leaked.length > 0) reasons.push('forbidden_source_contribution');

  // 2. registry 外の table を読んでいないか（E-S15 / Canon §22）。
  const registered = new Set<string>(Object.values(EXAM_SOURCE_TABLES).flat());
  if (input.readTables.some((t) => !registered.has(t))) reasons.push('unregistered_table');

  // 3. 寄与している source に provenance が揃っているか（Canon §39）。
  //    authority / tables / origin が欠けたまま prompt に載せない。
  const incomplete = input.sources.filter(
    (s) =>
      s.contribution !== 'none' &&
      (s.tables.length === 0 || s.authority === undefined || s.origin === undefined),
  );
  if (incomplete.length > 0) reasons.push('provenance_incomplete');

  // 4. identity を主張できない context を渡さない。
  if (!input.fingerprintAvailable) reasons.push('fingerprint_unavailable');

  return vetoWith(reasons);
}
