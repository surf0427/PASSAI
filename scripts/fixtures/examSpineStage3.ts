// Exam Spine — Stage 3 fixtures（canonical reader 用）。
//
// 役割:
//   実 Supabase を叩かずに Stage 3 reader の contract を検証するための
//   「行データ」と「query を記録する fake executor」。
//
// 厳守:
//   - 完全 synthetic。実ユーザーデータ・実 PII を含まない。
//   - deterministic。Date / Math.random / crypto / 環境依存値を使わない。
//   - production runtime から import しない（scripts/ 専用）。
//   - 実ネットワークを使わない（executor は純粋な in-memory 実装）。
//
// ★ fake executor は「単に行を返す」だけにしない ★
//   PostgREST の観測可能な挙動（filter / embedded filter / ordering / limit）を実際に再現する。
//   そうしないと ordering の tie-break や cap+1 の truncated 判定が「宣言しただけ」になり、
//   QA が実挙動を検証したことにならない。

import type { ExamReadExecutor, ExamReadQuery, ExamReadResponse } from '@/lib/examSpine/read/types';

// ── 行の型（PostgREST が返す raw row を模す。すべて unknown 前提）──────

export type FakeRow = Record<string, unknown>;

export type FakeDb = {
  /** table 名 → 行配列。 */
  tables: Record<string, FakeRow[]>;
  /** table 名 → PostgREST error を返させる。 */
  errors?: Record<string, { code: string; message: string }>;
  /** table 名 → executor 自体を throw させる。 */
  throws?: Record<string, string>;
};

export type QueryTraceEntry = {
  kind: string;
  role: 'core' | 'enrichment';
  table: string;
  columns: readonly string[];
  embedTable: string | null;
  embedColumns: readonly string[];
  filters: readonly string[];
  order: readonly string[];
  limit: number | null;
  mode: 'many' | 'maybeSingle';
};

export type RecordingExecutor = {
  executor: ExamReadExecutor;
  trace: QueryTraceEntry[];
  /** table 別の発行回数。enrichment を 0 本に抑えたことの検証に使う。 */
  countFor(table: string): number;
};

/** query を記録しつつ in-memory の行を返す executor。実ネットワークを使わない。 */
export function createRecordingExecutor(db: FakeDb): RecordingExecutor {
  const trace: QueryTraceEntry[] = [];

  const executor: ExamReadExecutor = async (query: ExamReadQuery): Promise<ExamReadResponse> => {
    trace.push(toTraceEntry(query));

    const thrown = db.throws?.[query.table];
    if (thrown) throw new Error(thrown);

    const err = db.errors?.[query.table];
    if (err) return { rows: null, error: { code: err.code, message: err.message } };

    let rows = [...(db.tables[query.table] ?? [])];

    // filter（embedded path `session.user_id` も含む）
    for (const f of query.filters) {
      if (f.op === 'eq') {
        rows = rows.filter((r) => readPath(r, f.column) === f.value);
      } else {
        const allowed = new Set(f.values);
        rows = rows.filter((r) => {
          const v = readPath(r, f.column);
          return typeof v === 'string' && allowed.has(v);
        });
      }
    }

    // ordering（宣言順に安定ソート）
    for (const o of [...query.order].reverse()) {
      rows = stableSort(rows, (a, b) => {
        const av = sortKey(a[o.column]);
        const bv = sortKey(b[o.column]);
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return o.ascending ? cmp : -cmp;
      });
    }

    if (query.mode === 'maybeSingle') {
      return { rows: rows.length === 0 ? [] : [rows[0]], error: null };
    }
    if (query.limit !== null) rows = rows.slice(0, query.limit);
    return { rows, error: null };
  };

  return {
    executor,
    trace,
    countFor: (table: string) => trace.filter((t) => t.table === table).length,
  };
}

function toTraceEntry(q: ExamReadQuery): QueryTraceEntry {
  return {
    kind: q.kind,
    role: q.role,
    table: q.table,
    columns: [...q.columns],
    embedTable: q.embed?.table ?? null,
    embedColumns: q.embed ? [...q.embed.columns] : [],
    filters: q.filters.map((f) =>
      f.op === 'eq' ? `eq:${f.column}` : `in:${f.column}(${f.values.length})`,
    ),
    order: q.order.map((o) => `${o.column} ${o.ascending ? 'ASC' : 'DESC'}`),
    limit: q.limit,
    mode: q.mode,
  };
}

/** `session.user_id` のような embedded path を辿る（object / 配列 / null すべて安全）。 */
function readPath(row: FakeRow, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = row;
  for (const part of parts) {
    if (Array.isArray(current)) current = current.length > 0 ? current[0] : null;
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function sortKey(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stableSort<T>(items: T[], cmp: (a: T, b: T) => number): T[] {
  return items
    .map((v, i) => ({ v, i }))
    .sort((a, b) => cmp(a.v, b.v) || a.i - b.i)
    .map((x) => x.v);
}

// ── 合成データ ────────────────────────────────────────────────────────

export const USER_A = 'user-aaaa-0000-0000-0000-000000000001';
export const USER_B = 'user-bbbb-0000-0000-0000-000000000002';

/**
 * basic_info_logs の payload。
 * ★ `name` を **入れない**。writer が氏名を strip して書く契約を fixture でも守る。
 *   ここに name を足すと「server から氏名が来る」前提のコードを QA が通してしまう。
 */
export function basicInfoRow(userId = USER_A): FakeRow {
  return {
    user_id: userId,
    payload: {
      grade: '高校3年',
      track: '文系',
      overallGpa: '4.2',
      examTypes: ['総合型選抜（AO入試）', '学校推薦型選抜'],
      preferences: [
        { university: 'サンプル大学', faculty: 'サンプル学部', department: 'サンプル学科' },
        { university: 'ダミー大学', faculty: 'ダミー学部' },
      ],
      subjectGrades: { english: '5', japanese: '4', absenceDays: '2' },
    },
    schema_version: '1',
    source_hash: 'fixture-hash-basic',
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-02T00:00:00.000Z',
  };
}

export function activityRow(userId = USER_A): FakeRow {
  return {
    user_id: userId,
    payload: {
      clubActivities: [{ clubName: 'サンプル陸上部' }, { clubName: 'サンプル文芸部' }],
      researchActivities: [{ theme: '商店街の来訪者調査' }],
      hobbyActivities: [],
      note: '配列でない値は件数に数えない',
    },
    schema_version: '1',
    source_hash: 'fixture-hash-activity',
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-02T00:00:00.000Z',
  };
}

export function diagnosisRow(userId = USER_A): FakeRow {
  return {
    user_id: userId,
    payload: { examTypeIndex: 2, answered: 12 },
    schema_version: '1',
    source_hash: 'fixture-hash-diagnosis',
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
  };
}

export function selfAnalysisRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `sa-${pad(n)}`,
    user_id: userId,
    analysis: {
      summary: `サンプル要約 ${n}`,
      strengths: ['粘り強さ', '調整力'],
      weaknesses: ['結論を急ぎがち'],
      futureConnections: ['地域政策の研究'],
      questions: ['きっかけは何ですか'],
    },
    summary: { activitySummary: `活動要約 ${n}`, strengths: '継続', appealPoints: '記録' },
    displayed_questions: ['質問1', '質問2'],
    answers: ['回答1'],
    deep_answers: ['追加メモ1'],
    free_memo: `自由メモ ${n}`,
    created_at: isoAt(n),
  }));
}

export function statementReviewRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `sr-${pad(n)}`,
    user_id: userId,
    local_review_id: `local-sr-${pad(n)}`,
    university: 'サンプル大学',
    faculty: 'サンプル学部',
    department: '',
    // ★ essay 列は fixture にも置かない（reader が SELECT しないため）。
    result: { weaknesses: ['具体性が弱い'], actions: ['数値を足す'], strengths: ['一貫性'] },
    created_at: isoAt(n),
  }));
}

export function selfPrRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `pr-${pad(n)}`,
    user_id: userId,
    local_pr_id: `local-pr-${pad(n)}`,
    pr_index: count - n, // ★ 意図的に updated_at と逆順。recency に使っていないことを検出する。
    title: `自己PR ${n}`,
    body: `本文 ${n}`,
    latest_result: `添削結果 ${n}`,
    created_at: isoAt(n),
    updated_at: isoAt(n),
  }));
}

export function essayRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `ws-${pad(n)}`,
    user_id: userId,
    local_workspace_id: `local-ws-${pad(n)}`,
    workspace: {
      theme: `お題 ${n}`,
      body: `小論文本文 ${n}`,
      // ★ jsonb 内の updatedAt。ORDER BY に使っていないことを検出するため、
      //   column の updated_at と **逆順**に置く。
      updatedAt: isoAt(count - n),
      reviews: [{ weakPoints: ['論拠が薄い'] }],
    },
    created_at: isoAt(n),
    updated_at: isoAt(n),
  }));
}

export function interviewRecordRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `ir-${pad(n)}`,
    user_id: userId,
    local_record_id: `local-ir-${pad(n)}`,
    practice_date: '2020-01-01',
    university_name: 'サンプル大学',
    faculty_name: 'サンプル学部',
    exam_type: '総合型選抜（AO入試）',
    main_question: `主な質問 ${n}`,
    improvement_summary: `改善点 ${n}`,
    what_went_wrong: `うまくいかなかった点 ${n}`,
    feedback_received: `もらった助言 ${n}`,
    self_noted: `自己メモ ${n}`,
    feedback_json: { improvements: ['結論を先に'] },
    // ★ 逐語列（questions_asked / my_answers）は fixture にも置かない。
    created_at: isoAt(n),
  }));
}

/**
 * interview_ai_results。PostgREST の embedded relation を模して `session` を持つ。
 * `embedAs` で object / 配列 / null を切り替え、どの形でも安全に扱えることを検証する。
 */
export function interviewAiResultRows(
  count: number,
  opts: { userId?: string; embedAs?: 'object' | 'array' | 'null'; startIndex?: number } = {},
): FakeRow[] {
  const userId = opts.userId ?? USER_A;
  const embedAs = opts.embedAs ?? 'object';
  const start = opts.startIndex ?? 1;
  return sequence(count, start).map((n) => {
    const session = {
      id: `ses-${pad(n)}`,
      user_id: userId,
      status: 'completed',
      interview_type: 'free',
      source: 'text',
      created_at: isoAt(n),
    };
    return {
      id: `res-${pad(n)}`,
      user_id: userId,
      session_id: `ses-${pad(n)}`,
      feedback: { summary: `面接フィードバック ${n}` },
      strengths: ['落ち着いて話せた'],
      improvements: ['結論を先に述べる'],
      next_practice: ['志望理由の深掘り'],
      created_at: isoAt(n),
      session: embedAs === 'object' ? session : embedAs === 'array' ? [session] : null,
    };
  });
}

export function presentationResultRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `pres-${pad(n)}`,
    user_id: userId,
    attempt_id: `att-${pad(n)}`,
    feedback: { categories: { logic: 'strong' } },
    categories: { logic: 'strong', delivery: 'normal' },
    qa_summary: null,
    final_report: null,
    created_at: isoAt(n),
  }));
}

export function presentationAttemptRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `att-${pad(n)}`,
    user_id: userId,
    session_id: `psess-${pad(n)}`,
    attempt_index: n,
    duration_sec: 180,
    status: 'evaluated',
    // ★ transcript / storage_path は fixture にも置かない（reader が SELECT しないため）。
    created_at: isoAt(n),
  }));
}

export function presentationSessionRows(count: number, userId = USER_A): FakeRow[] {
  return sequence(count).map((n) => ({
    id: `psess-${pad(n)}`,
    user_id: userId,
    university_name: 'サンプル大学',
    faculty_name: 'サンプル学部',
    department_name: 'サンプル学科',
    admission_type: '総合型選抜',
    presentation_format: 'スライドあり',
    theme: `発表テーマ ${n}`,
    university_notes: '面接重視',
    // ★ script / material_path は fixture にも置かない。
    created_at: isoAt(n),
  }));
}

/** 全 10 kind が満たされた DB。 */
export function fullDb(userId = USER_A): FakeDb {
  return {
    tables: {
      basic_info_logs: [basicInfoRow(userId)],
      activity_logs: [activityRow(userId)],
      diagnosis_logs: [diagnosisRow(userId)],
      self_analysis_logs: selfAnalysisRows(2, userId),
      statement_review_history: statementReviewRows(2, userId),
      self_prs: selfPrRows(2, userId),
      essay_workspaces: essayRows(2, userId),
      interview_practice_records: interviewRecordRows(2, userId),
      interview_ai_results: interviewAiResultRows(2, { userId }),
      presentation_results: presentationResultRows(2, userId),
      presentation_attempts: presentationAttemptRows(2, userId),
      presentation_sessions: presentationSessionRows(2, userId),
    },
  };
}

/** 新規ユーザー（全 table 空）。 */
export function emptyDb(): FakeDb {
  return {
    tables: {
      basic_info_logs: [],
      activity_logs: [],
      diagnosis_logs: [],
      self_analysis_logs: [],
      statement_review_history: [],
      self_prs: [],
      essay_workspaces: [],
      interview_practice_records: [],
      interview_ai_results: [],
      presentation_results: [],
      presentation_attempts: [],
      presentation_sessions: [],
    },
  };
}

// ── helper ────────────────────────────────────────────────────────────

function sequence(count: number, start = 1): number[] {
  return Array.from({ length: count }, (_, i) => i + start);
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

/** n が大きいほど新しい ISO 時刻（固定・決定論）。 */
export function isoAt(n: number): string {
  const day = String(n).padStart(2, '0');
  return `2020-03-${day}T00:00:00.000Z`;
}
