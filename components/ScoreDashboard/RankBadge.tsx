import { getRankDefinition } from '@/lib/scoreRank';

type Props = {
  score: number;
  size?: 'sm' | 'md' | 'lg';
};

const SIZE_MAP: Record<NonNullable<Props['size']>, string> = {
  sm: 'w-12 h-12 text-xl',
  md: 'w-16 h-16 text-3xl',
  lg: 'w-24 h-24 text-5xl',
};

export function RankBadge({ score, size = 'md' }: Props) {
  const def = getRankDefinition(score);
  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div
        className={`${SIZE_MAP[size]} ${def.badgeBg} ${def.badgeText} ring-4 ${def.badgeRing} rounded-full flex items-center justify-center font-bold leading-none`}
        aria-label={`ランク${def.rank}`}
      >
        {def.rank}
      </div>
      <span className={`text-xs font-semibold ${def.badgeText}`}>{def.label}</span>
    </div>
  );
}
