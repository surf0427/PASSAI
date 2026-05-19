// 受験チューターAI 用 basicInfo の compact section を作る純粋関数。
//
// 含める:
//   - grade（学年）
//   - track（文理）
//   - preferences[0].university / faculty（第一志望）
//   - examTypes[0]（受験方式の先頭）
// 含めない:
//   - name（個人特定情報）
//   - subjectGrades / overallGpa / 欠席日数（既存 SUBJECT_GRADES_ASYMMETRY_RULE 規約と整合）
//   - preferences[1..N]（複数志望、tutor では第一志望のみ）
//
// 入力欠損・型不一致時は throw せず空文字を返す。
// 部分欠損時は埋まっている情報だけ section に並べる。
//
// 関連: [types/basicInfo.ts](../../../types/basicInfo.ts)（canonical 型）

// 純粋関数原則: storage / fetch / AI / Date / Math.random 一切なし。

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildTutorBasicInfoSection(input: unknown): string {
  if (!isPlainObject(input)) return '';

  const grade = safeString(input.grade);
  const track = safeString(input.track);

  // preferences[0] から university / faculty を取り出す
  let university = '';
  let faculty = '';
  if (Array.isArray(input.preferences) && input.preferences.length > 0) {
    const first = input.preferences[0];
    if (isPlainObject(first)) {
      university = safeString(first.university);
      faculty = safeString(first.faculty);
    }
  }

  // examTypes[0]
  let examType = '';
  if (Array.isArray(input.examTypes) && input.examTypes.length > 0) {
    const first = input.examTypes[0];
    if (typeof first === 'string') {
      examType = first.trim();
    }
  }

  const lines: string[] = [];

  // 「高3 / 文系」のように 1 行に集約
  const gradeTrack: string[] = [];
  if (grade) gradeTrack.push(grade);
  if (track) gradeTrack.push(track);
  if (gradeTrack.length > 0) {
    lines.push(gradeTrack.join(' / '));
  }

  // 「第一志望: ○○大学 / ××学部」
  if (university || faculty) {
    const parts: string[] = [];
    if (university) parts.push(university);
    if (faculty) parts.push(faculty);
    lines.push(`第一志望: ${parts.join(' / ')}`);
  }

  if (examType) {
    lines.push(`受験方式: ${examType}`);
  }

  if (lines.length === 0) return '';

  return ['【受験生の基本情報】', ...lines].join('\n');
}
