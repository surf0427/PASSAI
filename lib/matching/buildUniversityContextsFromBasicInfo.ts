import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';

// basicInfo.preferences から UniversityContext[] を組み立てる暫定実装。
// 各志望校（空でないもののみ）について 1 つの UniversityContext を生成する。
//
// 現状埋まるフィールド:
//   universityName / facultyName / departmentName / examTypes
//
// TODO: 大学DBが整備されたら、各 universityName から
//   1. universityId を引き当てる
//   2. universityId / facultyId / departmentId をキーに
//      admissionPolicy / preferredTraits / preferredExperiences /
//      essayThemes / interviewTopics / requiredGpa を取得して merge する
//   3. enrich された UniversityContext[] を返す
//
// この関数は「marker」として残しておき、将来 enrichUniversityContextsFromDB を
// パイプして差し替える設計にする（型のシグネチャは保ったまま中身だけ拡張可能）。
export function buildUniversityContextsFromBasicInfo(
  basicInfo: BasicInfo | null,
): UniversityContext[] {
  if (!basicInfo) return [];
  const prefs = basicInfo.preferences ?? [];
  const examTypes = basicInfo.examTypes;

  return prefs
    .filter((p) => p.university.trim() !== '')
    .map((p) => ({
      universityName: p.university,
      facultyName: p.faculty?.trim() ? p.faculty : undefined,
      departmentName: (p.department ?? '').trim() || undefined,
      examTypes,
    }));
}

// 任意の MatchingResult / 大学名から、対応する UniversityContext を引く。
// API 側でプロンプト組み立てる際に使う。
export function findUniversityContextByName(
  contexts: UniversityContext[] | undefined,
  universityName: string,
): UniversityContext | null {
  if (!contexts || contexts.length === 0) return null;
  return contexts.find((c) => c.universityName === universityName) ?? null;
}
