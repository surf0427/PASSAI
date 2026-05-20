import { PRIORITY_NOTE_TEXT } from '@/lib/improvementSuggestions';

// amber 警告色は使わない。statement 系の soft トーン (blue-50 / blue-100) に揃える。
// 「警告」より「最初の一歩を示す」案内として読ませる。
export function PriorityNote() {
  return (
    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
      {PRIORITY_NOTE_TEXT}
    </p>
  );
}
