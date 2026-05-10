type Props = {
  message: string;
};

export function DashboardSummary({ message }: Props) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
          AI
        </span>
        <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}
