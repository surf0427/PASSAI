// UnusedExperience → prompt section（文章化）。探索型のみ・断定しない。
//
// 役割:
//   buildUnusedExperience() が返す UnusedExperience を、AI prompt の user message に差し込む
//   【まだ活用できていない可能性のある経験】section 文字列へ変換する純粋関数。
//   未使用「候補」を「まだ活用できる可能性のある経験」として提示し、本人に当てはまり主軸を自然に
//   補強できる場合のみ活用させる。断定・強制・捏造・主軸変更を促さない。
//
// 設計方針:
//   - pure。throw しない。AI / fetch / storage / Date / Math.random なし。
//   - false-unused（言い換えで既に触れている可能性）を前提に、「未使用」と断定しない文言にする。
//   - totalExperiences < MIN_TOTAL_EXPERIENCES（経験が少なく偏りが有意でない）または unused 空なら
//     空文字を返す（= section なし。後方互換 / 新規ユーザー noise 回避）。
//
// 関連: types/divergence.ts (UnusedExperience) / buildUnusedExperience.ts

import type { UnusedExperience } from '@/types/divergence';

// 偏りが有意になる最小経験数。これ未満は section を出さない。
const MIN_TOTAL_EXPERIENCES = 3;

export function buildUnusedExperienceSection(
  unusedExperience: UnusedExperience | null | undefined,
): string {
  if (!unusedExperience) return '';
  const totalExperiences = unusedExperience.basis?.totalExperiences ?? 0;
  if (totalExperiences < MIN_TOTAL_EXPERIENCES) return '';
  const items = Array.isArray(unusedExperience.unused) ? unusedExperience.unused : [];
  if (items.length === 0) return '';

  const lines: string[] = ['【まだ活用できていない可能性のある経験】', ''];
  lines.push(
    '以下は活動データに登録されていますが、これまでの自己PR・志望理由書・面接などでまだ触れられていない可能性のある経験です。',
  );
  lines.push('');
  lines.push(...items.map((i) => `- ${i.category}: ${i.title}`));
  lines.push('');
  lines.push('・これらは参考情報です。本人に当てはまり、自己PRの主軸を自然に補強できる場合のみ活用してください。');
  lines.push('・「未使用」と断定するものではありません（言い換えで既に触れている可能性もあります）。');
  lines.push('・無理に盛り込んだり、書かれていない事実を捏造したりしないでください。');
  lines.push('・中心となる経験や強み（主軸）を変える必要はありません。');
  return lines.join('\n');
}
