// 大学選択（プレゼン練習の志望大学・学部・入試方式など）の共有定義。
// client 専用（localStorage を扱う）。server-only にしない。純粋な型・定数・localStorage ヘルパのみ。

export const PRESENTATION_FORMATS = [
  '資料あり',
  '資料なし',
  '口頭発表',
  'ポスター発表',
  '不明',
] as const;

export const ADMISSION_TYPES = [
  '総合型選抜',
  '学校推薦型選抜',
  '公募推薦',
  '指定校推薦',
  'その他',
  '不明',
] as const;

export type UniversitySelection = {
  universityName: string;
  facultyName: string;
  departmentName: string;
  admissionType: string;
  presentationFormat: string;
  /** 制限時間（分）。input 値をそのまま保持。未入力は ''。 */
  limitMinutes: string;
  notes: string;
};

// AI 即興テーマ生成の結果（client/server 共有の形）。
export type GeneratedTheme = {
  theme: string;
  conditions: string[];
  questions: string[];
  // テーマの「切り口（theme_angle）」。多様性収束対策で追加（任意・後方互換）。
  //   angle           : AI が返した有効 angle key（無効なら chosen にフォールバック）。
  //   selectedAngleKey: サーバが実際に選んだ chosen.key（AI の echo とズレても除外に使う）。
  //   angleLabel      : ユーザー表示用の日本語ラベル（constants が server-only のため API 経由で渡す）。
  // DB には保存しない（generated_conditions / generated_questions / theme のみ保存）。
  angle?: string;
  selectedAngleKey?: string;
  angleLabel?: string;
};

export const EMPTY_UNIVERSITY_SELECTION: UniversitySelection = {
  universityName: '',
  facultyName: '',
  departmentName: '',
  admissionType: '',
  presentationFormat: '',
  limitMinutes: '',
  notes: '',
};

// localStorage キー（docs/shared の命名に倣い feature:purpose:version 形式）。
const STORAGE_KEY = 'presentation:university:v1';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function loadUniversitySelection(): UniversitySelection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return {
      universityName: asString(obj.universityName),
      facultyName: asString(obj.facultyName),
      departmentName: asString(obj.departmentName),
      admissionType: asString(obj.admissionType),
      presentationFormat: asString(obj.presentationFormat),
      limitMinutes: asString(obj.limitMinutes),
      notes: asString(obj.notes),
    };
  } catch {
    return null;
  }
}

export function saveUniversitySelection(sel: UniversitySelection): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
  } catch {
    // localStorage 不可（プライベートモード等）は黙って無視。
  }
}

// 入力値が「実質空」か（大学名すら無い）。setup の表示分岐に使う。
export function isEmptyUniversitySelection(sel: UniversitySelection | null): boolean {
  return !sel || !sel.universityName.trim();
}
