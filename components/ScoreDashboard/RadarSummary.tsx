import { EVAL_MAX_SCORE } from '@/lib/scoreRank';
import { Card } from '@/components/ui/Card';

type RadarItem = {
  label: string;
  score: number;
};

type Props = {
  items: RadarItem[];
};

const SIZE = 280;
const CENTER = SIZE / 2;
const RADIUS = SIZE * 0.32;
const RING_RATIOS = [0.25, 0.5, 0.75, 1];

// 真上 (-90deg) を起点に時計回りで配置する
function angleAt(index: number, total: number): number {
  return -Math.PI / 2 + (index * 2 * Math.PI) / total;
}

function pointOnCircle(angle: number, radius: number): { x: number; y: number } {
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

export function RadarSummary({ items }: Props) {
  const total = items.length;

  const dataPoints = items.map((it, i) => {
    const ratio = Math.max(0, Math.min(EVAL_MAX_SCORE, it.score)) / EVAL_MAX_SCORE;
    return pointOnCircle(angleAt(i, total), RADIUS * ratio);
  });

  const axisPoints = items.map((_, i) => pointOnCircle(angleAt(i, total), RADIUS));

  const labelPoints = items.map((it, i) => {
    const p = pointOnCircle(angleAt(i, total), RADIUS + 24);
    return { ...p, label: it.label };
  });

  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <Card className="h-full">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">バランス</h3>
      <p className="text-xs text-slate-500 mb-2">どこに伸びしろがあるか確認しましょう</p>
      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="w-full max-w-[280px] h-auto"
          role="img"
          aria-label="評価バランス"
        >
          {RING_RATIOS.map((ratio, ri) => {
            const pts = items
              .map((_, i) => pointOnCircle(angleAt(i, total), RADIUS * ratio))
              .map((p) => `${p.x},${p.y}`)
              .join(' ');
            return (
              <polygon
                key={ri}
                points={pts}
                fill={ri === RING_RATIOS.length - 1 ? '#f8fafc' : 'none'}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
            );
          })}

          {axisPoints.map((p, i) => (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER}
              x2={p.x}
              y2={p.y}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
          ))}

          <polygon
            points={dataPolygon}
            fill="rgba(59,130,246,0.18)"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {dataPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#3b82f6" />
          ))}

          {labelPoints.map((p, i) => (
            <text
              key={i}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-600"
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              {p.label}
            </text>
          ))}
        </svg>
      </div>
    </Card>
  );
}
