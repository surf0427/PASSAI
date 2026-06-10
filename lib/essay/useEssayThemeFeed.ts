'use client';

// 小論文テーマの「無限フィード」を管理する client hook。
//
// 役割（3 件固定循環の廃止）:
//   - 初回シードは決定論テンプレ getEssayThemeCandidates()（即時・AI コスト 0）。
//   - 「別のテーマを見る」= next():
//       1) 未表示のシード／既生成分が残っていれば次を表示（AI 呼び出しなし）
//       2) 末尾まで見終わったら /api/essay-themes で新テーマを追加生成して append
//       3) 生成失敗・quota 超過・新規 0 件なら既存テーマを循環表示（行き止まり回避）
//   - 既出テーマと category を API に渡し、重複回避 & 切り口分散を促す。
//
// 設計判断:
//   - シードは target をキーに useMemo で再計算する（mount 直後 target が空→確定する
//     ライフサイクルでも正しいシードに追従させるため）。
//   - 追加生成分は extra(state) に分離し、表示は [...seed, ...extra]。target が変われば
//     index/extra をリセットする。
//   - workspace 確定保存（updateTheme/upsert）は呼び出し側ページの責務。本 hook は
//     表示候補の供給のみで localStorage に書き込まない（ghost autosave 防止の既存方針）。

import { useCallback, useMemo, useState } from 'react';
import {
  getEssayThemeCandidates,
  type EssayThemeCandidate,
} from '@/lib/essayThemes';
import { loadBasicInfo } from '@/lib/basicInfoStorage';

export type EssayThemeFeedTarget = {
  university: string;
  faculty: string;
  department: string;
  examType: string;
};

const normalizeKey = (theme: string): string => theme.replace(/\s+/g, '').trim();

// 既出テーマ／カテゴリを prompt 肥大なく渡すための上限。
const MAX_SHOWN_THEMES_TO_SEND = 24;

export type EssayThemeFeed = {
  current: EssayThemeCandidate;
  index: number; // 0-based の表示位置
  total: number; // 現在の候補総数
  loadingMore: boolean;
  error: string | null;
  next: () => void;
};

export function useEssayThemeFeed(
  target: EssayThemeFeedTarget,
  // quota 超過時に dialog を出し true を返す既存フック（useQuotaDialog().handleResponse）。
  handleQuotaResponse: (res: Response) => Promise<boolean>,
): EssayThemeFeed {
  const targetKey = `${target.university}|${target.faculty}|${target.department}|${target.examType}`;

  // 決定論シード。target が変わるたびに再計算（必ず 1 件以上返る契約）。
  const seed = useMemo(
    () =>
      getEssayThemeCandidates({
        university: target.university,
        faculty: target.faculty,
        department: target.department,
        examType: target.examType,
      }),
    [target.university, target.faculty, target.department, target.examType],
  );

  const [extra, setExtra] = useState<EssayThemeCandidate[]>([]);
  const [index, setIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // target が変わったら追加生成分と表示位置をリセット（別 workspace 扱い）。
  // React 公式の「key 変化時に render 中で state を調整する」パターン。effect 内 setState
  // を避け、cascading render を起こさずに mount 直後の target 確定にも追従する。
  const [prevTargetKey, setPrevTargetKey] = useState(targetKey);
  if (prevTargetKey !== targetKey) {
    setPrevTargetKey(targetKey);
    setExtra([]);
    setIndex(0);
    setError(null);
  }

  const items = useMemo(() => [...seed, ...extra], [seed, extra]);

  const safeIndex = Math.min(index, items.length - 1);
  const current = items[safeIndex];

  const next = useCallback(() => {
    if (loadingMore) return;

    // 1) まだ未表示の候補が残っていれば AI を呼ばず次へ。
    if (safeIndex < items.length - 1) {
      setIndex(safeIndex + 1);
      return;
    }

    // 2) 末尾。新テーマを追加生成する。
    setLoadingMore(true);
    setError(null);

    const seen = new Set(items.map((c) => normalizeKey(c.theme)));
    const alreadyShownThemes = items
      .map((c) => c.theme)
      .slice(-MAX_SHOWN_THEMES_TO_SEND);
    const usedCategories = items.map((c) => c.themeType);
    const baseLength = items.length;

    void (async () => {
      try {
        const res = await fetch('/api/essay-themes', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            university: target.university,
            faculty: target.faculty,
            department: target.department,
            examType: target.examType,
            alreadyShownThemes,
            usedCategories,
            basicInfo: loadBasicInfo(),
          }),
        });

        // quota 超過は dialog に委譲し、既存テーマを循環表示して継続。
        if (await handleQuotaResponse(res)) {
          setIndex((i) => (baseLength > 0 ? (i + 1) % baseLength : 0));
          return;
        }

        const data = (await res.json().catch(() => ({}))) as {
          themes?: EssayThemeCandidate[];
        };
        const incoming = Array.isArray(data.themes) ? data.themes : [];
        const fresh = incoming.filter(
          (c) =>
            c &&
            typeof c.theme === 'string' &&
            c.theme.trim() !== '' &&
            !seen.has(normalizeKey(c.theme)),
        );

        if (!res.ok || fresh.length === 0) {
          // 失敗・新規ゼロ: 行き止まりにせず既存を循環表示する。
          if (!res.ok) {
            setError(
              '新しいテーマの生成に失敗しました。表示済みのテーマを再表示します。',
            );
          }
          setIndex((i) => (baseLength > 0 ? (i + 1) % baseLength : 0));
          return;
        }

        setExtra((prev) => [...prev, ...fresh]);
        setIndex(baseLength); // append された先頭（新テーマ）を表示。
      } catch {
        setError(
          '新しいテーマの生成に失敗しました。表示済みのテーマを再表示します。',
        );
        setIndex((i) => (baseLength > 0 ? (i + 1) % baseLength : 0));
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [
    loadingMore,
    safeIndex,
    items,
    target.university,
    target.faculty,
    target.department,
    target.examType,
    handleQuotaResponse,
  ]);

  return {
    current,
    index: safeIndex,
    total: items.length,
    loadingMore,
    error,
    next,
  };
}
