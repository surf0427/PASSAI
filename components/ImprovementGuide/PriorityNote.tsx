import { PRIORITY_NOTE_TEXT } from '@/lib/improvementSuggestions';

export function PriorityNote() {
  return (
    <p className="text-xs sm:text-sm text-slate-500 leading-relaxed bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
      {PRIORITY_NOTE_TEXT}
    </p>
  );
}
