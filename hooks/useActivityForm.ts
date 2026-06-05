'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { saveActivityData, loadActivityData, clearActivityData } from '@/lib/activityStorage';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import { useCurrentUserId } from '@/app/components/AuthProvider';
import { validateActivityForm } from '@/lib/activityValidator';
import type { BasicInfo } from '@/types/basicInfo';
import type {
  ActivityData,
  ClubActivity,
  VolunteerActivity,
  StudyAbroadActivity,
  ResearchActivity,
  PartTimeJobActivity,
  CertificationActivity,
  ContestActivity,
  ReadingActivity,
  HobbyActivity,
  OtherActivity,
} from '@/types/activity';
import {
  newClubActivity,
  newVolunteerActivity,
  newStudyAbroadActivity,
  newResearchActivity,
  newPartTimeJobActivity,
  newCertificationActivity,
  newContestActivity,
  newReadingActivity,
  newHobbyActivity,
  newOtherActivity,
} from '@/lib/activityFactories';

const initialActivityData: ActivityData = {
  clubActivities: [],
  volunteerActivities: [],
  studyAbroadActivities: [],
  researchActivities: [],
  partTimeJobActivities: [],
  certificationActivities: [],
  contestActivities: [],
  readingActivities: [],
  hobbyActivities: [],
  otherActivities: [],
};

// マウント前 false / マウント後 true を返す flag。
// loadBasicInfo() は localStorage 依存のため SSR では null を返したい一方、
// useEffect 内 setState で初期化すると react-hooks/set-state-in-effect になる。
// useSyncExternalStore の getServerSnapshot/getSnapshot を使うと、
// この semantics を setState なしで表現できる。
// （f46eb35 PartTimeJobActivitySection と同形パターン）
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export function useActivityForm() {
  const router = useRouter();
  // STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: submit-driven dualWrite に使う owner key。
  // null（auth 未確定）なら dualWrite は呼ばず、AuthProvider の backfill が後で拾う。
  const currentUserId = useCurrentUserId();
  const [activityData, setActivityData] = useState<ActivityData>(
    () => loadActivityData() ?? initialActivityData,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // マウント前は null、マウント後に loadBasicInfo() の値（保存値 or null）を返す。
  // useMemo([isMounted]) により、マウント後は1度だけ JSON.parse して以降は同一参照を返す。
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const basicInfo = useMemo<BasicInfo | null>(
    () => (isMounted ? loadBasicInfo() : null),
    [isMounted],
  );

  // 変更検知: 入力のたびに自動保存
  // 初回レンダー時はスキップ（復元前の空データで上書きするのを防ぐ）
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    saveActivityData(activityData);
  }, [activityData]);

  function handleReset() {
    clearActivityData();
    setActivityData(initialActivityData);
    setErrors([]);
  }

  // ── 部活動 ──────────────────────────────────────────────────────────────────

  function addClubActivity() {
    setActivityData((prev) => ({ ...prev, clubActivities: [...prev.clubActivities, newClubActivity()] }));
  }
  function removeClubActivity(index: number) {
    setActivityData((prev) => ({ ...prev, clubActivities: prev.clubActivities.filter((_, i) => i !== index) }));
  }
  function updateClubActivity(index: number, field: keyof Omit<ClubActivity, 'type' | 'period'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      clubActivities: prev.clubActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as ClubActivity) : item
      ),
    }));
  }
  function updateClubPeriod(index: number, field: 'from' | 'to', value: string) {
    setActivityData((prev) => ({
      ...prev,
      clubActivities: prev.clubActivities.map((item, i) =>
        i === index ? { ...item, period: { ...item.period, [field]: value } } : item
      ),
    }));
  }

  // ── ボランティア ─────────────────────────────────────────────────────────────

  function addVolunteerActivity() {
    setActivityData((prev) => ({ ...prev, volunteerActivities: [...prev.volunteerActivities, newVolunteerActivity()] }));
  }
  function removeVolunteerActivity(index: number) {
    setActivityData((prev) => ({ ...prev, volunteerActivities: prev.volunteerActivities.filter((_, i) => i !== index) }));
  }
  function updateVolunteerActivity(index: number, field: keyof Omit<VolunteerActivity, 'type' | 'period'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      volunteerActivities: prev.volunteerActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as VolunteerActivity) : item
      ),
    }));
  }

  // ── 留学 ────────────────────────────────────────────────────────────────────

  function addStudyAbroadActivity() {
    setActivityData((prev) => ({ ...prev, studyAbroadActivities: [...prev.studyAbroadActivities, newStudyAbroadActivity()] }));
  }
  function removeStudyAbroadActivity(index: number) {
    setActivityData((prev) => ({ ...prev, studyAbroadActivities: prev.studyAbroadActivities.filter((_, i) => i !== index) }));
  }
  function updateStudyAbroadActivity(index: number, field: keyof Omit<StudyAbroadActivity, 'type' | 'period'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      studyAbroadActivities: prev.studyAbroadActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as StudyAbroadActivity) : item
      ),
    }));
  }
  function updateStudyAbroadPeriod(index: number, field: 'from' | 'to', value: string) {
    setActivityData((prev) => ({
      ...prev,
      studyAbroadActivities: prev.studyAbroadActivities.map((item, i) =>
        i === index ? { ...item, period: { ...item.period, [field]: value } } : item
      ),
    }));
  }

  // ── 探究 ────────────────────────────────────────────────────────────────────

  function addResearchActivity() {
    setActivityData((prev) => ({ ...prev, researchActivities: [...prev.researchActivities, newResearchActivity()] }));
  }
  function removeResearchActivity(index: number) {
    setActivityData((prev) => ({ ...prev, researchActivities: prev.researchActivities.filter((_, i) => i !== index) }));
  }
  function updateResearchActivity(index: number, field: keyof Omit<ResearchActivity, 'type' | 'period'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      researchActivities: prev.researchActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as ResearchActivity) : item
      ),
    }));
  }

  // ── アルバイト ───────────────────────────────────────────────────────────────

  function addPartTimeJobActivity() {
    setActivityData((prev) => ({ ...prev, partTimeJobActivities: [...prev.partTimeJobActivities, newPartTimeJobActivity()] }));
  }
  function removePartTimeJobActivity(index: number) {
    setActivityData((prev) => ({ ...prev, partTimeJobActivities: prev.partTimeJobActivities.filter((_, i) => i !== index) }));
  }
  function updatePartTimeJobActivity(index: number, field: keyof Omit<PartTimeJobActivity, 'type' | 'period'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      partTimeJobActivities: prev.partTimeJobActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as PartTimeJobActivity) : item
      ),
    }));
  }
  function updatePartTimeJobPeriod(index: number, field: 'from' | 'to', value: string) {
    setActivityData((prev) => ({
      ...prev,
      partTimeJobActivities: prev.partTimeJobActivities.map((item, i) =>
        i === index ? { ...item, period: { ...item.period, [field]: value } } : item
      ),
    }));
  }

  // ── 資格 ────────────────────────────────────────────────────────────────────

  function addCertificationActivity() {
    setActivityData((prev) => ({ ...prev, certificationActivities: [...prev.certificationActivities, newCertificationActivity()] }));
  }
  function removeCertificationActivity(index: number) {
    setActivityData((prev) => ({ ...prev, certificationActivities: prev.certificationActivities.filter((_, i) => i !== index) }));
  }
  function updateCertificationActivity(index: number, field: keyof Omit<CertificationActivity, 'type'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      certificationActivities: prev.certificationActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as CertificationActivity) : item
      ),
    }));
  }

  // ── コンテスト ───────────────────────────────────────────────────────────────

  function addContestActivity() {
    setActivityData((prev) => ({ ...prev, contestActivities: [...prev.contestActivities, newContestActivity()] }));
  }
  function removeContestActivity(index: number) {
    setActivityData((prev) => ({ ...prev, contestActivities: prev.contestActivities.filter((_, i) => i !== index) }));
  }
  function updateContestActivity(index: number, field: keyof Omit<ContestActivity, 'type' | 'period'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      contestActivities: prev.contestActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as ContestActivity) : item
      ),
    }));
  }

  // ── 読書 ────────────────────────────────────────────────────────────────────

  function addReadingActivity() {
    setActivityData((prev) => ({ ...prev, readingActivities: [...prev.readingActivities, newReadingActivity()] }));
  }
  function removeReadingActivity(index: number) {
    setActivityData((prev) => ({ ...prev, readingActivities: prev.readingActivities.filter((_, i) => i !== index) }));
  }
  function updateReadingActivity(index: number, field: keyof Omit<ReadingActivity, 'type'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      readingActivities: prev.readingActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as ReadingActivity) : item
      ),
    }));
  }

  // ── 趣味 ────────────────────────────────────────────────────────────────────

  function addHobbyActivity() {
    setActivityData((prev) => ({ ...prev, hobbyActivities: [...prev.hobbyActivities, newHobbyActivity()] }));
  }
  function removeHobbyActivity(index: number) {
    setActivityData((prev) => ({ ...prev, hobbyActivities: prev.hobbyActivities.filter((_, i) => i !== index) }));
  }
  function updateHobbyActivity(index: number, field: keyof Omit<HobbyActivity, 'type'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      hobbyActivities: prev.hobbyActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as HobbyActivity) : item
      ),
    }));
  }

  // ── その他 ──────────────────────────────────────────────────────────────────

  function addOtherActivity() {
    setActivityData((prev) => ({ ...prev, otherActivities: [...prev.otherActivities, newOtherActivity()] }));
  }
  function removeOtherActivity(index: number) {
    setActivityData((prev) => ({ ...prev, otherActivities: prev.otherActivities.filter((_, i) => i !== index) }));
  }
  function updateOtherActivity(index: number, field: keyof Omit<OtherActivity, 'type' | 'period'>, value: string) {
    setActivityData((prev) => ({
      ...prev,
      otherActivities: prev.otherActivities.map((item, i) =>
        i === index ? ({ ...item, [field]: value } as OtherActivity) : item
      ),
    }));
  }
  function updateOtherPeriod(index: number, field: 'from' | 'to', value: string) {
    setActivityData((prev) => ({
      ...prev,
      otherActivities: prev.otherActivities.map((item, i) =>
        i === index ? { ...item, period: { ...item.period, [field]: value } } : item
      ),
    }));
  }

  // ── 送信 ─────────────────────────────────────────────────────────────────────

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newErrors = validateActivityForm(activityData);
    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    try {
      // 【sessionStorage】AI分析ページへの一時的なデータ受け渡し。
      // SSRガードは不要（ユーザー操作時のみ実行される）。
      // safeStorage は localStorage 専用のため使用しない。
      sessionStorage.setItem('activityData', JSON.stringify(activityData));

      // Phase1: Supabase へ best-effort mirror（fire-and-forget）.
      // Submit-driven trigger — STEP-PHASE1M で確定した contract。
      // **autosave 経路 (saveActivityData) には mirror dispatch を入れない**：
      // per-keystroke autosave に直結させると 1000-5000 writes/session に
      // 膨らみ、`mirror_events` の signal/noise を破壊するため。
      //
      // 動的 import を使う理由: hook が SSR 経路に静的 import される可能性
      // (server component から `'use client'` hook を読む等) に備え、browser
      // boundary file（"use client"）を server bundle に静的に引き込まない。
      //
      // mirror helper は契約上 throw / reject しないが、防御として .catch
      // を付ける。outer try/catch は sessionStorage.setItem 失敗の検知に
      // 専念し、mirror 失敗が canonical UX に波及しないよう独立。
      void import('@/lib/supabase/mirrorActivityData')
        .then((mod) =>
          mod.mirrorActivityDataToSupabase({
            payload: activityData as unknown as Record<string, unknown>,
          }),
        )
        .catch(() => {});

      // STEP-TUTOR-CONTEXT-PHASE2-REPOSITORY-01: auth-scoped durable（activity_logs）へ
      // best-effort dualWrite（submit-driven・fire-and-forget）。
      //   - userId 未確定なら no-op（AuthProvider の backfill が後で拾う）。
      //   - await しない / 例外握り潰し / dynamic import で boundary 安全。
      //   - 既存 anonymous mirror（上の mirrorActivityData）には触らない（別経路）。
      //   - autosave (saveActivityData) には絶対に dualWrite を入れない（flood 防止）。
      if (currentUserId) {
        const userId = currentUserId;
        void import('@/lib/repository/activityRepository')
          .then((mod) => mod.dualWriteActivityLog({ userId, activityData }))
          .catch(() => {});
      }
    } catch (e) {
      console.error('useActivityForm: sessionStorage save failed', e);
      setErrors(['保存に失敗しました。入力内容をコピーしてから再読み込みしてください。']);
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
    setIsSuccess(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    router.push('/home');
  }

  function handleBack() {
    setErrors([]);
    setIsSubmitted(false);
  }

  return {
    activityData,
    errors,
    isSubmitted,
    isLoading,
    isSuccess,
    basicInfo,
    handleSubmit,
    handleReset,
    handleBack,
    addClubActivity, removeClubActivity, updateClubActivity, updateClubPeriod,
    addVolunteerActivity, removeVolunteerActivity, updateVolunteerActivity,
    addStudyAbroadActivity, removeStudyAbroadActivity, updateStudyAbroadActivity, updateStudyAbroadPeriod,
    addResearchActivity, removeResearchActivity, updateResearchActivity,
    addPartTimeJobActivity, removePartTimeJobActivity, updatePartTimeJobActivity, updatePartTimeJobPeriod,
    addCertificationActivity, removeCertificationActivity, updateCertificationActivity,
    addContestActivity, removeContestActivity, updateContestActivity,
    addReadingActivity, removeReadingActivity, updateReadingActivity,
    addHobbyActivity, removeHobbyActivity, updateHobbyActivity,
    addOtherActivity, removeOtherActivity, updateOtherActivity, updateOtherPeriod,
  };
}
