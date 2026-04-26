'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { BasicFormData, SchoolPreference, ExamType } from '@/types/basicInfo';
import { saveBasicInfo, loadBasicInfo } from '@/lib/basicInfoStorage';

type FormErrors = {
  name?: string;
  highSchool?: string;
  grade?: string;
  stream?: string;
  examType?: string;
  firstPreferenceUniversity?: string;
  firstPreferenceFaculty?: string;
};

const EXAM_TYPE_OPTIONS: { value: ExamType; label: string }[] = [
  { value: 'AO',                          label: '総合型選抜' },
  { value: 'RECOMMENDATION',              label: '学校推薦型選抜' },
  { value: 'BOTH',                        label: '両方検討中' },
  { value: 'GENERAL_WITH_RECOMMENDATION', label: '一般受験メイン（推薦も併用）' },
];

const PREFERENCE_LABELS = ['第一志望', '第二志望', '第三志望', '第四志望', '第五志望'];

const initialFormData: BasicFormData = {
  name: '',
  highSchool: '',
  grade: '',
  stream: '',
  examType: '',
  preferences: [
    { university: '', faculty: '' },
    { university: '', faculty: '' },
    { university: '', faculty: '' },
    { university: '', faculty: '' },
    { university: '', faculty: '' },
  ],
};

export default function BasicInfoPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<BasicFormData>(initialFormData);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    const saved = loadBasicInfo();
    if (saved) setFormData(saved);
  }, []);

  useEffect(() => {
    saveBasicInfo(formData);
  }, [formData]);

  function handleChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value } as BasicFormData));
    setErrors((prev) => ({ ...prev, [name]: undefined } as FormErrors));
  }

  function handlePreferenceChange(
    index: number,
    field: keyof SchoolPreference,
    value: string
  ) {
    const newPreferences = formData.preferences.map((pref, i) =>
      i === index ? { ...pref, [field]: value } : pref
    );
    setFormData((prev) => ({ ...prev, preferences: newPreferences }));
    if (index === 0 && field === 'university') {
      setErrors((prev) => ({ ...prev, firstPreferenceUniversity: undefined }));
    }
    if (index === 0 && field === 'faculty') {
      setErrors((prev) => ({ ...prev, firstPreferenceFaculty: undefined }));
    }
  }

  function validateForm(): FormErrors {
    const newErrors: FormErrors = {};
    if (!formData.name.trim()) {
      newErrors.name = '名前を入力してください';
    }
    if (!formData.highSchool.trim()) {
      newErrors.highSchool = '高校名を入力してください';
    }
    if (!formData.grade) {
      newErrors.grade = '学年を選んでください';
    }
    if (!formData.stream) {
      newErrors.stream = '文系か理系を選んでください';
    }
    if (!formData.examType) {
      newErrors.examType = '受験方式を選んでください';
    }
    if (!formData.preferences[0].university.trim()) {
      newErrors.firstPreferenceUniversity = '第一志望の大学名を入力してください';
    }
    if (!formData.preferences[0].faculty.trim()) {
      newErrors.firstPreferenceFaculty = '第一志望の学部名を入力してください';
    }
    return newErrors;
  }

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const newErrors = validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    saveBasicInfo(formData);
    router.push('/input/activity');
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-800 mb-8">基本情報入力</h1>
      <form onSubmit={handleSubmit} noValidate>

        {/* 基本情報 */}
        <section className="mb-10">
          <h2 className="text-base font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
            基本情報
          </h2>
          <div className="space-y-5">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                名前 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="例：山田 太郎"
              />
              {errors.name && (
                <p className="text-red-500 text-xs mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                高校名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="highSchool"
                value={formData.highSchool}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="例：〇〇高等学校"
              />
              {errors.highSchool && (
                <p className="text-red-500 text-xs mt-1">{errors.highSchool}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                学年 <span className="text-red-500">*</span>
              </label>
              <select
                name="grade"
                value={formData.grade}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">選択してください</option>
                <option value="高校1年">高校1年</option>
                <option value="高校2年">高校2年</option>
                <option value="高校3年">高校3年</option>
              </select>
              {errors.grade && (
                <p className="text-red-500 text-xs mt-1">{errors.grade}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                文系・理系 <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="stream"
                    value="文系"
                    checked={formData.stream === '文系'}
                    onChange={handleChange}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">文系</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="stream"
                    value="理系"
                    checked={formData.stream === '理系'}
                    onChange={handleChange}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">理系</span>
                </label>
              </div>
              {errors.stream && (
                <p className="text-red-500 text-xs mt-1">{errors.stream}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                受験方式 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {EXAM_TYPE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="examType"
                      value={option.value}
                      checked={formData.examType === option.value}
                      onChange={handleChange}
                      className="w-4 h-4 shrink-0"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
              {errors.examType && (
                <p className="text-red-500 text-xs mt-1">{errors.examType}</p>
              )}
            </div>

          </div>
        </section>

        {/* 志望校 */}
        <section className="mb-10">
          <h2 className="text-base font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
            志望校
          </h2>
          <div className="space-y-4">
            {formData.preferences.map((pref, index) => {
              const isRequired = index === 0;
              const label = PREFERENCE_LABELS[index];
              return (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${
                    isRequired
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    {label}
                    {isRequired ? (
                      <span className="text-red-500 ml-1 text-xs">（必須）</span>
                    ) : (
                      <span className="text-gray-400 ml-1 text-xs">（任意）</span>
                    )}
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">大学名</label>
                      <input
                        type="text"
                        value={pref.university}
                        onChange={(e) =>
                          handlePreferenceChange(index, 'university', e.target.value)
                        }
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        placeholder="例：〇〇大学"
                      />
                      {index === 0 && errors.firstPreferenceUniversity && (
                        <p className="text-red-500 text-xs mt-1">
                          {errors.firstPreferenceUniversity}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">学部名</label>
                      <input
                        type="text"
                        value={pref.faculty}
                        onChange={(e) =>
                          handlePreferenceChange(index, 'faculty', e.target.value)
                        }
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        placeholder="例：〇〇学部"
                      />
                      {index === 0 && errors.firstPreferenceFaculty && (
                        <p className="text-red-500 text-xs mt-1">
                          {errors.firstPreferenceFaculty}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-md transition-colors"
        >
          保存して活動整理フォームへ進む →
        </button>

      </form>
    </div>
  );
}
