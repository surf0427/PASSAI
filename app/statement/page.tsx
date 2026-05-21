'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStatementPrepareSummary } from '@/lib/statement/prepare/statementPrepareStorage';
import { loadDraft } from '@/lib/statement/review/statementStorage';
import {
  getLatestStatementScore,
  getStatementScoreDelta,
} from '@/lib/statement/score/statementScoreSource';

// マウント前 false / マウント後 true。`/interview/page.tsx` と同形パターン。
// SSR では localStorage を読まず status=null（全 stat を `—`、4 モードは通常 description）にし、
// hydration 後に client で helper を呼んで再 render する。
const subscribeMount = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

type Status = {
  preparedReady: boolean;
  draftChars: number;
  latestScore: number | null;
  delta: number | null;
};

type Mode = {
  href: string;
  title: string;
  // status=null（mount 前）なら通常文を返すよう各実装で揃える。
  getDescription: (status: Status | null) => string;
  // status=null（mount 前）なら必ず false（=タップ可）を返すよう揃える。
  isDisabled?: (status: Status | null) => boolean;
};

const MODES: Mode[] = [
  {
    href: '/statement/prepare/university',
    title: '書く前に整理する',
    getDescription: (s) =>
      s && !s.preparedReady
        ? 'まず書く材料を整えましょう。'
        : '大学の評価軸に合わせて整理します。',
  },
  {
    href: '/statement/edit',
    title: '志望理由書を書く',
    getDescription: (s) =>
      s && s.draftChars === 0
        ? '白紙から書き始めます。'
        : '下書きを作成・更新します。',
  },
  {
    href: '/statement/score',
    title: '今のスコアを見る',
    // スコア未作成でも disabled にしない: 「次に何をすべきか」を伝える役割を残す。
    getDescription: (s) =>
      s && s.latestScore === null
        ? 'まず志望理由書を書いてみましょう。'
        : '現在地と前回からの変化を確認します。',
  },
  {
    href: '/statement/improve',
    title: '書き直す',
    getDescription: (s) =>
      s && s.latestScore === null
        ? 'スコア確認後に使えます。'
        : '過去に書いた志望理由書を選んで書き直します。',
    isDisabled: (s) => s !== null && s.latestScore === null,
  },
];

export default function StatementEntryPage() {
  const isMounted = useSyncExternalStore(
    subscribeMount,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );

  const status = useMemo<Status | null>(() => {
    if (!isMounted) return null;
    const preparedReady = getStatementPrepareSummary() !== null;
    const draftChars = loadDraft()?.statementText.length ?? 0;
    const latestScore = getLatestStatementScore()?.total ?? null;
    const delta = getStatementScoreDelta();
    return { preparedReady, draftChars, latestScore, delta };
  }, [isMounted]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <PageHeader
        title="志望理由書"
        description="今やりたいことを選んでください。"
      />

      <Card variant="soft" padding="md" className="mb-5 sm:mb-6">
        <p className="text-[11px] font-bold text-blue-700 tracking-widest mb-3">
          現在地
        </p>
        <div className="grid grid-cols-2 gap-y-3 gap-x-4">
          <StatusItem label="整理済み" value={displayPrepared(status)} />
          <StatusItem label="下書き" value={displayDraft(status)} />
          <StatusItem label="最新スコア" value={displayScore(status)} />
          <StatusItem
            label="前回比"
            value={displayDelta(status)}
            tone={deltaTone(status)}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {MODES.map((m) => (
          <ModeCard
            key={m.href}
            href={m.href}
            title={m.title}
            description={m.getDescription(status)}
            disabled={m.isDisabled?.(status) ?? false}
          />
        ))}
      </div>
    </div>
  );
}

const EM_DASH = '—';

function displayPrepared(status: Status | null): string {
  if (!status) return EM_DASH;
  return status.preparedReady ? '整理済み' : EM_DASH;
}

function displayDraft(status: Status | null): string {
  if (!status) return EM_DASH;
  return status.draftChars > 0 ? `${status.draftChars}文字` : '未作成';
}

function displayScore(status: Status | null): string {
  if (!status || status.latestScore === null) return EM_DASH;
  return String(status.latestScore);
}

function displayDelta(status: Status | null): string {
  if (!status || status.delta === null) return EM_DASH;
  const d = status.delta;
  if (d > 0) return `+${d}`;
  return String(d);
}

function deltaTone(status: Status | null): 'default' | 'positive' {
  if (!status || status.delta === null || status.delta <= 0) return 'default';
  return 'positive';
}

function StatusItem({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive';
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
      <p
        className={`text-sm font-semibold truncate ${
          tone === 'positive' ? 'text-emerald-600' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

const CARD_BASE =
  'block rounded-2xl bg-white ring-1 ring-slate-200 shadow-card transition-all p-4 sm:p-5 min-h-[120px]';
const CARD_ACTIVE = 'hover:shadow-md active:bg-slate-50';
const CARD_DISABLED = 'opacity-60 pointer-events-none';

// 「使えない」より「まだ今ではない」空気感を出すため、disabled でも
// ring/shadow/レイアウトは維持し、テキスト彩度だけ下げる。
function ModeCard({
  href,
  title,
  description,
  disabled,
}: {
  href: string;
  title: string;
  description: string;
  disabled: boolean;
}) {
  const titleClass = `text-sm sm:text-base font-bold mb-1.5 leading-snug ${
    disabled ? 'text-slate-400' : 'text-slate-900'
  }`;
  const descClass = `text-xs leading-relaxed ${
    disabled ? 'text-slate-400' : 'text-slate-500'
  }`;

  const inner = (
    <>
      <h2 className={titleClass}>{title}</h2>
      <p className={descClass}>{description}</p>
    </>
  );

  if (disabled) {
    return (
      <div
        aria-disabled="true"
        className={`${CARD_BASE} ${CARD_DISABLED}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link href={href} className={`${CARD_BASE} ${CARD_ACTIVE}`}>
      {inner}
    </Link>
  );
}
