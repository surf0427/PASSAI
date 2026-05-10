'use client';

import { useState } from 'react';
import type { NgWordIssue } from '@/lib/detectNgWords';
import { getQuestionsForPhrase } from '@/lib/deepDiveQuestions';
import { safeGetStorage, safeSetStorage } from '@/lib/storage/safeStorage';

export type DeepDiveSession = {
  phrase: string;
  questions: string[];
  answers: string[];
  currentIndex: number;
};

export type CompletedDeepDive = {
  phrase: string;
  questions: string[];
  answers: string[];
  completedAt: string;
};

type CompletedMap = Record<string, CompletedDeepDive>;

const STORAGE_KEY = 'ngDeepDiveResults';

export function useDeepDive() {
  const [active, setActive] = useState<DeepDiveSession | null>(null);
  const [completed, setCompleted] = useState<CompletedMap>(() =>
    safeGetStorage<CompletedMap>(STORAGE_KEY, {})
  );

  function start(issue: NgWordIssue) {
    setActive({
      phrase: issue.phrase,
      questions: getQuestionsForPhrase(issue.phrase),
      answers: [],
      currentIndex: 0,
    });
  }

  function submitAnswer(answer: string) {
    if (!active) return;
    const newAnswers = [...active.answers, answer.trim()];
    const nextIndex = active.currentIndex + 1;

    if (nextIndex >= active.questions.length) {
      const result: CompletedDeepDive = {
        phrase: active.phrase,
        questions: active.questions,
        answers: newAnswers,
        completedAt: new Date().toISOString(),
      };
      const updated = { ...completed, [active.phrase]: result };
      safeSetStorage(STORAGE_KEY, updated);
      setCompleted(updated);
    }

    setActive({ ...active, answers: newAnswers, currentIndex: nextIndex });
  }

  function goBack() {
    if (!active || active.currentIndex === 0) return;
    setActive({
      ...active,
      answers: active.answers.slice(0, -1),
      currentIndex: active.currentIndex - 1,
    });
  }

  function close() {
    setActive(null);
  }

  const isComplete = active !== null && active.currentIndex >= active.questions.length;

  return { active, completed, isComplete, start, submitAnswer, goBack, close };
}
