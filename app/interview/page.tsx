'use client';

import { useEffect, useState } from 'react';
import type { BasicInfo } from '@/types/basicInfo';
import { loadBasicInfo } from '@/lib/basicInfoStorage';
import BasicInfoSummary from '@/components/shared/BasicInfoSummary';
import { InterviewMenuCard } from './components/InterviewMenuCard';

const MENU_ITEMS = [
  {
    title: '予想質問を作る',
    description: '志望大学・活動内容をもとに、面接で聞かれそうな質問を作ります。',
    buttonLabel: '予想質問を作る',
    href: '/interview/questions',
  },
  {
    title: '練習結果を記録する',
    description: '先生や友達との面接練習後に、質問内容や回答を記録します。',
    buttonLabel: '練習結果を記録する',
    href: '/interview/record',
  },
  {
    title: '過去の練習記録を見る',
    description: 'これまでの面接練習の記録と改善点を確認します。',
    buttonLabel: '練習記録を見る',
    href: '/interview/history',
  },
];

export default function InterviewPage() {
  // 表示用に basicInfo を取得する。共通関数 loadBasicInfo() 経由で localStorage を直接読まない。
  const [basicInfo, setBasicInfo] = useState<BasicInfo | null>(null);
  useEffect(() => {
    setBasicInfo(loadBasicInfo());
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-3">面接練習</h1>
        <p className="text-gray-600 text-sm leading-relaxed">
          AIが予想質問の作成や、対人練習後の振り返りをサポートします。
        </p>
      </div>

      <BasicInfoSummary basicInfo={basicInfo} />

      <div className="grid gap-4">
        {MENU_ITEMS.map((item) => (
          <InterviewMenuCard
            key={item.href}
            title={item.title}
            description={item.description}
            buttonLabel={item.buttonLabel}
            href={item.href}
          />
        ))}
      </div>
    </div>
  );
}
