// 大学情報（session の想定大学・学部・入試方式など）の表示用ヘルパ。result / history 共用。
// presentation_sessions の行から抽出し、後方互換として universityName が無ければ null を返す。

export type UniversityInfo = {
  universityName: string;
  facultyName: string;
  departmentName: string;
  admissionType: string;
  presentationFormat: string;
  presentationLimitSec: number | null;
  notes: string;
};

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// session 行（RLS owner SELECT 済み）から UniversityInfo を作る。大学名が無ければ null。
export function parseUniversityInfo(
  row: Record<string, unknown> | null | undefined,
): UniversityInfo | null {
  if (!row) return null;
  const universityName = s(row.university_name);
  if (!universityName) return null;
  return {
    universityName,
    facultyName: s(row.faculty_name),
    departmentName: s(row.department_name),
    admissionType: s(row.admission_type),
    presentationFormat: s(row.presentation_format),
    presentationLimitSec:
      typeof row.presentation_limit_sec === 'number'
        ? row.presentation_limit_sec
        : null,
    notes: s(row.university_notes),
  };
}

// result 画面: 想定大学情報セクション（空項目は出さない / 備考は小さめ）。
export function UniversityInfoCard({ info }: { info: UniversityInfo }) {
  const rows: { label: string; value: string }[] = [
    { label: '大学名', value: info.universityName },
    { label: '学部名', value: info.facultyName },
    { label: '学科名', value: info.departmentName },
    { label: '入試方式', value: info.admissionType },
    { label: 'プレゼン形式', value: info.presentationFormat },
    {
      label: '想定制限時間',
      value: info.presentationLimitSec
        ? `${Math.round(info.presentationLimitSec / 60)} 分`
        : '',
    },
  ].filter((r) => r.value);

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-bold text-slate-900">想定大学情報</h2>
      <dl className="space-y-0.5 text-sm text-slate-700">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2">
            <dt className="w-24 shrink-0 text-slate-500">{r.label}</dt>
            <dd className="min-w-0 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
      {info.notes && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">
            備考
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
            {info.notes}
          </p>
        </details>
      )}
    </div>
  );
}

// history カード: 大学情報の概要を 1〜2 行でコンパクト表示（備考は出さない）。
export function UniversityInfoLine({ info }: { info: UniversityInfo }) {
  const head = [info.universityName, info.facultyName, info.departmentName]
    .filter(Boolean)
    .join(' ');
  const sub = [info.admissionType, info.presentationFormat]
    .filter(Boolean)
    .join(' / ');
  return (
    <div className="text-sm text-slate-600">
      <p className="truncate">{head}</p>
      {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
