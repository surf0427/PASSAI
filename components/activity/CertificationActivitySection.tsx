import { useState, useRef, useEffect } from 'react';
import type { CertificationActivity } from '@/types/activity';
import { ActivityCard } from './ActivityCard';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FormField } from '@/components/ui/FormField';
import { AlertBox } from '@/components/ui/AlertBox';
import { Button } from '@/components/ui/Button';

const ERROR_INPUT_CLASS = '!border-red-400 focus:!ring-red-400';
const TEXTAREA_CLASS = 'resize-none min-h-[80px]';

type Props = {
  activities: CertificationActivity[];
  errors?: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof Omit<CertificationActivity, 'type'>, value: string) => void;
};

export default function CertificationActivitySection({ activities, errors, onAdd, onRemove, onUpdate }: Props) {
  const [isOpen, setIsOpen] = useState(activities.length > 0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const atLimit = activities.length >= 3;
  const prevLen = useRef(activities.length);
  useEffect(() => {
    if (activities.length > prevLen.current) setEditingIndex(activities.length - 1);
    prevLen.current = activities.length;
  }, [activities.length]);

  function handleAdd() {
    if (atLimit) return;
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
          aria-expanded={isOpen}
          aria-controls="certification-activity-section-content"
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-sm font-semibold text-gray-700">資格・検定</span>
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
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={atLimit}
          className="ml-3 shrink-0"
        >
          ＋ 追加{atLimit ? '（上限3件）' : ''}
        </Button>
      </div>

      {isOpen && (
        <div id="certification-activity-section-content" className="border-t border-gray-100 px-4 pt-3 pb-4">
          {errors && errors.length > 0 && (
            <AlertBox variant="error" className="mb-3">
              <ul className="space-y-1">
                {errors.map((e, i) => <li key={i} className="text-sm text-red-600">{e}</li>)}
              </ul>
            </AlertBox>
          )}
          {activities.length === 0 && (
            <p className="text-sm text-gray-400 py-2">＋追加ボタンで入力欄を追加できます</p>
          )}
          <div className="space-y-4">
            {activities.map((activity, index) => {
              // この section だけ per-field error フラグを持つ（資格名 / レベル / 取得目的）。
              // それぞれのフィールドの input/textarea に !border-red-400 を被せて UX を維持する。
              const p = `資格${index + 1}: `;
              const nameErr = errors?.some(e => e.startsWith(p + '資格名')) ?? false;
              const levelErr = errors?.some(e => e.startsWith(p + 'レベル')) ?? false;
              const purposeErr = errors?.some(e => e.startsWith(p + '取得目的')) ?? false;
              return (
                <ActivityCard
                  key={index}
                  label={`資格・検定 ${index + 1}`}
                  summary={[activity.certificationName, activity.level].filter(Boolean).join('　')}
                  isEditing={editingIndex === index}
                  onEdit={() => setEditingIndex(index)}
                  onDone={() => setEditingIndex(null)}
                  onRemove={() => confirmRemove(index)}
                >
                  <FormField label="資格名" required>
                    <Input
                      type="text"
                      value={activity.certificationName}
                      onChange={(e) => onUpdate(index, 'certificationName', e.target.value)}
                      placeholder="例：英検、TOEIC"
                      className={nameErr ? ERROR_INPUT_CLASS : ''}
                    />
                  </FormField>
                  <FormField label="レベル/スコア" required>
                    <Input
                      type="text"
                      value={activity.level}
                      onChange={(e) => onUpdate(index, 'level', e.target.value)}
                      placeholder="例：2級、750点"
                      className={levelErr ? ERROR_INPUT_CLASS : ''}
                    />
                  </FormField>
                  <FormField label="取得時期">
                    <Input
                      type="text"
                      value={activity.acquiredDate}
                      onChange={(e) => onUpdate(index, 'acquiredDate', e.target.value)}
                      placeholder="例：2024年1月"
                    />
                  </FormField>
                  <FormField label="取得目的" required>
                    <Textarea
                      value={activity.purpose}
                      onChange={(e) => onUpdate(index, 'purpose', e.target.value)}
                      placeholder="なぜこの資格を取ろうと思ったか"
                      className={`${TEXTAREA_CLASS} ${purposeErr ? ERROR_INPUT_CLASS : ''}`}
                    />
                  </FormField>
                  <FormField
                    label="うまくいったこと"
                    hint="短くても大丈夫です。一言からでもOK。"
                  >
                    <Textarea
                      value={activity.reflection}
                      onChange={(e) => onUpdate(index, 'reflection', e.target.value)}
                      placeholder="うまくいったこと・よかったことなど"
                      className={TEXTAREA_CLASS}
                    />
                  </FormField>
                  <FormField label="失敗・苦労したこと">
                    <Textarea
                      value={activity.difficulty}
                      onChange={(e) => onUpdate(index, 'difficulty', e.target.value)}
                      placeholder="困ったこと・苦労したことなど"
                      className={TEXTAREA_CLASS}
                    />
                  </FormField>
                </ActivityCard>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
