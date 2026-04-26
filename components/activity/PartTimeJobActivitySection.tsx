import { useState, useRef, useEffect } from 'react';
import type { PartTimeJobActivity } from '@/types/activity';
import { ActivityCard } from './ActivityCard';

const inputClass = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const inputErrorClass = 'w-full border border-red-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400';
const textareaClass = `${inputClass} resize-none min-h-[80px]`;
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
const fieldClass = 'mb-3';
const addBtnClass = 'text-sm text-blue-600 border border-blue-300 rounded px-3 py-1 hover:bg-blue-50 shrink-0';
const deleteBtnClass = 'text-xs text-red-500 border border-red-300 rounded px-2 py-1 hover:bg-red-50';

type Props = {
  activities: PartTimeJobActivity[];
  errors?: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof Omit<PartTimeJobActivity, 'type' | 'period'>, value: string) => void;
  onUpdatePeriod: (index: number, field: 'from' | 'to', value: string) => void;
};

export default function PartTimeJobActivitySection({ activities, errors, onAdd, onRemove, onUpdate, onUpdatePeriod }: Props) {
  const [isOpen, setIsOpen] = useState(activities.length > 0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const prevLen = useRef(activities.length);
  useEffect(() => {
    if (activities.length > prevLen.current) setEditingIndex(activities.length - 1);
    prevLen.current = activities.length;
  }, [activities.length]);

  function handleAdd() {
    setIsOpen(true);
    onAdd();
  }

  function confirmRemove(index: number) {
    if (!window.confirm('この活動を削除しますか？\nこの操作は元に戻せません。')) return;
    setEditingIndex(null);
    onRemove(index);
  }

  return (
    <section className="mb-4 border border-gray-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-sm font-semibold text-gray-700">アルバイト</span>
          {activities.length > 0 && (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
              {activities.length}件
            </span>
          )}
          {errors && errors.length > 0 && (
            <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full shrink-0">
              要確認
            </span>
          )}
          <svg
            className={`ml-auto w-4 h-4 text-gray-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button type="button" onClick={handleAdd} className={`${addBtnClass} ml-3`}>
          ＋ 追加
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-gray-100 px-4 pt-3 pb-4">
          {errors && errors.length > 0 && (
            <ul className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md space-y-1">
              {errors.map((e, i) => <li key={i} className="text-sm text-red-600">{e}</li>)}
            </ul>
          )}
          {activities.length === 0 && (
            <p className="text-sm text-gray-400 py-2">＋追加ボタンで入力欄を追加できます</p>
          )}
          <div className="space-y-4">
            {activities.map((activity, index) => {
              const hasError = errors?.some(e => e.startsWith(`アルバイト${index + 1}:`)) ?? false;
              return (
                <ActivityCard
                  key={index}
                  label={`アルバイト ${index + 1}`}
                  summary={[activity.industry, activity.jobContent].filter(Boolean).join(' / ')}
                  isEditing={editingIndex === index}
                  onEdit={() => setEditingIndex(index)}
                  onDone={() => setEditingIndex(null)}
                  onRemove={() => confirmRemove(index)}
                >
                  <div className={fieldClass}>
                    <label className={labelClass}>業種 <span className="text-red-500">*</span></label>
                    <input type="text" className={hasError ? inputErrorClass : inputClass} value={activity.industry}
                      onChange={(e) => onUpdate(index, 'industry', e.target.value)}
                      placeholder="例：飲食、小売" />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>業務内容</label>
                    <input type="text" className={inputClass} value={activity.jobContent}
                      onChange={(e) => onUpdate(index, 'jobContent', e.target.value)}
                      placeholder="具体的な業務内容" />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>勤務頻度</label>
                    <input type="text" className={inputClass} value={activity.workFrequency}
                      onChange={(e) => onUpdate(index, 'workFrequency', e.target.value)}
                      placeholder="例：週2回" />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>期間</label>
                    <div className="flex gap-2 items-center">
                      <input type="text" className={inputClass} value={activity.period.from}
                        onChange={(e) => onUpdatePeriod(index, 'from', e.target.value)}
                        placeholder="例：2024年4月" />
                      <span className="text-gray-400 shrink-0">〜</span>
                      <input type="text" className={inputClass} value={activity.period.to}
                        onChange={(e) => onUpdatePeriod(index, 'to', e.target.value)}
                        placeholder="例：現在" />
                    </div>
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>印象に残っていること</label>
                    <textarea className={textareaClass} value={activity.description}
                      onChange={(e) => onUpdate(index, 'description', e.target.value)}
                      placeholder="アルバイトを通じて印象に残っていることを書いてください" />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>うまくいったこと</label>
                    <textarea className={textareaClass} value={activity.achievement}
                      onChange={(e) => onUpdate(index, 'achievement', e.target.value)}
                      placeholder="うまくいったこと・成果など" />
                  </div>
                  <div className={fieldClass}>
                    <label className={labelClass}>失敗・苦労したこと</label>
                    <textarea className={textareaClass} value={activity.challenge}
                      onChange={(e) => onUpdate(index, 'challenge', e.target.value)}
                      placeholder="困ったこと・苦労したことなど" />
                  </div>
                </ActivityCard>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
