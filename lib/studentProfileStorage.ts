// StudentProfile の canonical 保存層。
//
// 役割:
//   StudentProfile を PASSAI 全体で共有する「共通プロフィール（人格データ）」として
//   localStorage に保存・取得する。下流 feature（statement / interview / matching / essay /
//   self-pr）が共通入力として読む唯一の正本。
//
// 保存対象に含めるもの:
//   summary / strengths / weaknesses / futureConnections / valueKeywords /
//   signatureEpisodes / version / generatedAt / sourceHash
//
// 保存対象に含めないもの（StudentProfile 設計の原則）:
//   - questions / answers          → 壁打ちフロー内部の working memory
//   - selfPRDraft / interviewPoints → 各 feature の artifact（別 storage で扱う）
//
// Supabase 移行ロードマップ:
//   StudentProfile は PASSAI 全体で最初に DB へ持ち上げる対象。
//   このファイルだけ書き換えれば移行できるように、外部 import 元は
//   必ず本ファイルの関数経由にする（直接 localStorage を読まない）。
//
// 関連: types/studentProfile.ts / lib/studentProfile.ts(toStudentProfile)

import type { StudentProfile, SignatureEpisode } from '@/types/studentProfile';
import { safeGetStorage, safeSetStorage, safeRemoveStorage } from '@/lib/storage/safeStorage';

const STUDENT_PROFILE_KEY = 'studentProfile';

// 既存 StudentProfile の sourceHash と一致する場合は再保存をスキップする判定。
// 不変なら書き込まないことで（同 hash の上書き ≒ 無意味な write）、
// localStorage の event 発火や履歴揺らぎを抑える。
export function shouldUpdateStudentProfile(
  prev: StudentProfile | null,
  next: StudentProfile,
): boolean {
  if (!prev) return true;
  if (prev.version !== next.version) return true;
  return prev.sourceHash !== next.sourceHash;
}

export function saveStudentProfile(profile: StudentProfile): void {
  const prev = loadStudentProfile();
  if (!shouldUpdateStudentProfile(prev, profile)) return;
  safeSetStorage(STUDENT_PROFILE_KEY, profile);
}

export function loadStudentProfile(): StudentProfile | null {
  const raw = safeGetStorage<unknown>(STUDENT_PROFILE_KEY, null);
  if (!isStudentProfile(raw)) return null;
  return raw;
}

export function clearStudentProfile(): void {
  safeRemoveStorage(STUDENT_PROFILE_KEY);
}

// 受け取った任意の値が StudentProfile として読めるかの最小限の runtime guard。
// 旧形式のデータが混入した場合に「壊れたまま下流に流す」のを防ぐ。
// 厳密な validation はしない（version 増加時の migration はその時点で別途設計する）。
export function isStudentProfile(value: unknown): value is StudentProfile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v.version !== 1) return false;
  if (typeof v.generatedAt !== 'string') return false;
  if (typeof v.sourceHash !== 'string') return false;
  if (typeof v.summary !== 'string') return false;

  if (!isStringArray(v.strengths)) return false;
  if (!isStringArray(v.weaknesses)) return false;
  if (!isStringArray(v.futureConnections)) return false;
  if (!isStringArray(v.valueKeywords)) return false;

  if (!Array.isArray(v.signatureEpisodes)) return false;
  if (!v.signatureEpisodes.every(isSignatureEpisode)) return false;

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}

function isSignatureEpisode(value: unknown): value is SignatureEpisode {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === 'string' &&
    typeof v.summary === 'string' &&
    typeof v.relatedStrengthIdx === 'number'
  );
}
