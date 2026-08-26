// Exam Spine — tutor server loader QA fixtures。
//
// 役割:
//   lib/contextBuilders/tutorContext.ts の **server 読み取り経路**（Supabase から読み、
//   TutorStudentContext を組み、prompt section へ整形するまで）の出力を固定するための
//   合成 DB row。scripts/exam-spine-tutor-loader-qa.ts が唯一の消費者。
//
// 厳守:
//   - **完全 synthetic**。実ユーザーデータ・実 PII を一切含まない。
//   - deterministic。Date.now / Math.random / crypto / 環境依存値を使わない。
//     created_at は固定の ISO 文字列を使う（formatDateJst の出力を安定させるため）。
//   - production runtime から import しない（scripts/ 専用）。
//
// 関連: docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md

/** stub Supabase client が table ごとに返す結果。 */
export type StubTableResult =
  // 正常応答。data は maybeSingle 系なら単体、list 系なら配列。
  | { kind: 'ok'; data: unknown }
  // PostgREST error（table 不存在 / RLS 拒否 等）。
  | { kind: 'error'; code: string }
  // query 実行時の例外（接続断 等）。
  | { kind: 'throw' };

export type TutorLoaderFixture = {
  /** fixture ID（snapshot ファイル名に使う）。 */
  id: string;
  /** 何を代表するケースか。 */
  description: string;
  /** table 名 → stub 応答。未指定の table は {kind:'ok', data:null} 扱い。 */
  tables: Record<string, StubTableResult>;
};

// 固定日時（JST 変換結果が安定するよう UTC 正午を使う）。
const T1 = '2024-05-06T03:00:00.000Z';
const T2 = '2024-11-30T12:00:00.000Z';

export const TUTOR_LOADER_FIXTURES: readonly TutorLoaderFixture[] = [
  {
    id: 'T1-all-sources',
    description: '6 source すべてが揃っているユーザー（最大構成）',
    tables: {
      self_analysis_logs: {
        kind: 'ok',
        data: [
          {
            created_at: T1,
            analysis: {
              summary: 'サンプル要約テキスト。探究活動を通じて課題設定力を伸ばしたと自己認識している。',
              strengths: ['サンプル強み1', 'サンプル強み2', 'サンプル強み3', 'サンプル強み4（切り捨て対象）'],
              weaknesses: ['サンプル弱み1', 'サンプル弱み2', 'サンプル弱み3（切り捨て対象）'],
              futureConnections: ['サンプル将来接続1', 'サンプル将来接続2', 'サンプル将来接続3（切り捨て対象）'],
            },
            summary: {
              activitySummary: 'サンプル活動要約（analysis.summary があるので使われない想定）',
              appealPoints: 'サンプルアピールポイント。継続的に取り組んだ点を強調できる。',
            },
          },
        ],
      },
      basic_info_logs: {
        kind: 'ok',
        data: {
          payload: {
            name: 'テスト太郎（PII: 読まれてはいけない）',
            grade: '高校3年',
            track: '文系',
            examTypes: ['総合型選抜', '学校推薦型選抜'],
            overallGpa: '4.2（PII: 読まれてはいけない）',
            subjectGrades: { english: '5' },
            preferences: [
              { university: 'サンプル大学A', faculty: 'サンプル学部A', department: 'サンプル学科A' },
              { university: 'サンプル大学B', faculty: 'サンプル学部B' },
              { university: 'サンプル大学C', faculty: 'サンプル学部C' },
              { university: 'サンプル大学D（切り捨て対象）', faculty: 'サンプル学部D' },
            ],
          },
        },
      },
      diagnosis_logs: { kind: 'ok', data: { payload: { resultType: 2 } } },
      activity_logs: {
        kind: 'ok',
        data: {
          payload: {
            clubActivities: [{ title: 'サンプル部活' }, { title: 'サンプル部活2' }],
            volunteerActivities: [{ title: 'サンプルボランティア' }],
            researchActivities: [{ title: 'サンプル探究' }],
            unknownCategory: [{ title: '未知カテゴリ（集計対象外）' }],
          },
        },
      },
      interview_ai_sessions: {
        kind: 'ok',
        data: [
          {
            created_at: T1,
            interview_type: 'self_analysis',
            interview_ai_results: [
              {
                feedback: {
                  overallEvaluation: 'サンプル総合評価。落ち着いて答えられていた。',
                  goodPoints: ['サンプル良点1', 'サンプル良点2', 'サンプル良点3', 'サンプル良点4（切り捨て）'],
                  improvements: ['サンプル改善1', 'サンプル改善2', 'サンプル改善3', 'サンプル改善4（切り捨て）'],
                  nextPractice: ['サンプル次練習1', 'サンプル次練習2', 'サンプル次練習3（切り捨て）'],
                },
              },
            ],
          },
        ],
      },
      presentation_results: {
        kind: 'ok',
        data: [
          {
            created_at: T2,
            attempt_id: 'attempt-fixture-0001',
            feedback: {
              overallComment: 'サンプルプレゼン総合評価。構成は明快だった。',
              goodPoints: ['サンプルP良点1', 'サンプルP良点2', 'サンプルP良点3', 'サンプルP良点4（切り捨て）'],
              improvements: ['サンプルP改善1', 'サンプルP改善2', 'サンプルP改善3', 'サンプルP改善4（切り捨て）'],
              nextPractice: ['サンプルP次1', 'サンプルP次2', 'サンプルP次3（切り捨て）'],
              categories: {
                composition: 'strong',
                persuasion: 'normal',
                concreteness: 'weak',
                clarity: 'strong',
                timeManagement: 'normal',
                completeness: 'strong',
                materialConsistency: 'normal',
              },
            },
          },
        ],
      },
      presentation_attempts: {
        kind: 'ok',
        data: {
          presentation_sessions: {
            university_name: 'サンプル大学A',
            faculty_name: 'サンプル学部A',
            theme: 'サンプル発表テーマ。地域課題への取り組みについて。',
          },
        },
      },
    },
  },

  {
    id: 'T2-new-user-empty',
    description: '新規ユーザー。全 table が空（fail-open で空 context を返すこと）',
    tables: {
      self_analysis_logs: { kind: 'ok', data: [] },
      basic_info_logs: { kind: 'ok', data: null },
      diagnosis_logs: { kind: 'ok', data: null },
      activity_logs: { kind: 'ok', data: null },
      interview_ai_sessions: { kind: 'ok', data: [] },
      presentation_results: { kind: 'ok', data: [] },
    },
  },

  {
    id: 'T3-partial-basic-and-self',
    description: '一部 source のみ（basic_info + self_analysis）。他は空',
    tables: {
      self_analysis_logs: {
        kind: 'ok',
        data: [
          {
            created_at: T1,
            analysis: { strengths: ['サンプル強みのみ'] },
            summary: null,
          },
        ],
      },
      basic_info_logs: {
        kind: 'ok',
        data: { payload: { grade: '高校2年', preferences: [{ university: 'サンプル大学X', faculty: '' }] } },
      },
      diagnosis_logs: { kind: 'ok', data: null },
      activity_logs: { kind: 'ok', data: { payload: {} } },
      interview_ai_sessions: { kind: 'ok', data: [] },
      presentation_results: { kind: 'ok', data: [] },
    },
  },

  {
    id: 'T4-source-failures',
    description:
      '一部 source が error / throw（fail-open: 他 source は通常どおり返ること）',
    tables: {
      self_analysis_logs: { kind: 'error', code: '42P01' }, // relation 不存在
      basic_info_logs: {
        kind: 'ok',
        data: { payload: { grade: '高校3年', examTypes: ['総合型選抜'] } },
      },
      diagnosis_logs: { kind: 'throw' },
      activity_logs: { kind: 'ok', data: { payload: { clubActivities: [{ t: 1 }] } } },
      interview_ai_sessions: { kind: 'error', code: 'PGRST301' }, // RLS 拒否相当
      presentation_results: { kind: 'throw' },
    },
  },

  {
    id: 'T5-adversarial-shapes',
    description:
      'jsonb の shape が契約外（数値 / null / ネスト配列 / 巨大文字列）。defensive parsing を固定する',
    tables: {
      self_analysis_logs: {
        kind: 'ok',
        data: [
          {
            created_at: 'not-a-date',
            analysis: {
              summary: 'あ'.repeat(500),
              strengths: ['い'.repeat(200), 123, null, '', '   ', 'ラスト強み'],
              weaknesses: 'これは配列ではない',
              futureConnections: [['ネスト配列']],
            },
            summary: { appealPoints: 42 },
          },
        ],
      },
      basic_info_logs: {
        kind: 'ok',
        data: {
          payload: {
            grade: 'う'.repeat(100),
            examTypes: 'これは配列ではない',
            preferences: [null, 'string-not-object', { university: 123, faculty: '  空白トリム対象  ' }],
          },
        },
      },
      diagnosis_logs: { kind: 'ok', data: { payload: { resultType: 'unknown-exam-type' } } },
      activity_logs: { kind: 'ok', data: { payload: { clubActivities: 'not-an-array', volunteerActivities: [] } } },
      interview_ai_sessions: {
        kind: 'ok',
        data: [{ created_at: T1, interview_type: 'not-a-valid-type', interview_ai_results: { feedback: { goodPoints: ['単体オブジェクト embed'] } } }],
      },
      presentation_results: {
        kind: 'ok',
        data: [{ created_at: T2, attempt_id: '', feedback: { categories: { composition: 'bogus-level' } } }],
      },
    },
  },

  {
    id: 'T6-presentation-enrichment-fails',
    description:
      'プレゼン core は取れるが attempt→session の enrichment が失敗（core だけ返ること）',
    tables: {
      self_analysis_logs: { kind: 'ok', data: [] },
      basic_info_logs: { kind: 'ok', data: null },
      diagnosis_logs: { kind: 'ok', data: null },
      activity_logs: { kind: 'ok', data: null },
      interview_ai_sessions: { kind: 'ok', data: [] },
      presentation_results: {
        kind: 'ok',
        data: [
          {
            created_at: T2,
            attempt_id: 'attempt-fixture-0002',
            feedback: { overallComment: 'サンプル総合評価のみ', goodPoints: ['サンプル良点'] },
          },
        ],
      },
      presentation_attempts: { kind: 'throw' },
    },
  },
];
