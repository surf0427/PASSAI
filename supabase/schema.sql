-- Phase1 Supabase schema — StudentProfile mirror sink (minimal).
--
-- Design rationale & open questions:
--   docs/supabase/schema_phase1_student_profile.md
--
-- Phase1 contract this SQL upholds:
--   - localStorage remains canonical. This table is best-effort mirror only.
--   - No SELECT path exists yet. SELECT / DELETE policies are intentionally
--     omitted so the database itself blocks reads, mirroring
--     docs/supabase/phase1_runtime_strategy.md §8.
--   - No auth coupling. user_id / FK introduction is deferred to a Phase2
--     migration STEP (see schema_phase1_student_profile.md §10).
--   - This file is not applied automatically by any runtime code; it is
--     intended to be executed once via the Supabase SQL editor / CLI.

-- 1. Required extension (Supabase usually has it pre-installed; declare for
--    safety so the rest of the file runs on a fresh project).
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- 2. Table.
CREATE TABLE student_profile_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE student_profile_mirrors IS
  'Phase1 best-effort mirror sink for StudentProfile. localStorage is canonical. '
  'No SELECT policy by design — see docs/supabase/schema_phase1_student_profile.md.';

COMMENT ON COLUMN student_profile_mirrors.source_hash IS
  'Deterministic identity of the canonical snapshot. Upsert conflict target.';

COMMENT ON COLUMN student_profile_mirrors.schema_version IS
  'Canonical contract version. Future migrations may filter on this.';

COMMENT ON COLUMN student_profile_mirrors.payload IS
  'Opaque jsonb snapshot. Phase1 has no query requirements; structured-column '
  'expansion is deferred to a later STEP (schema_phase1_student_profile.md §9).';


-- 3. Trigger: keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER student_profile_mirrors_set_updated_at
  BEFORE UPDATE ON student_profile_mirrors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 4. RLS — write-only access for the anon role.
--    INSERT + UPDATE are required because the mirror helper performs an
--    upsert (INSERT ... ON CONFLICT DO UPDATE). SELECT and DELETE policies
--    are intentionally not created so the database mirrors the Phase1
--    no-reads / no-destructive-rollback contract at the storage layer.
ALTER TABLE student_profile_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_profile_mirrors anon insert"
  ON student_profile_mirrors
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "student_profile_mirrors anon update"
  ON student_profile_mirrors
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);


-- 5. Mirror events sink (observability) — Phase1.
--    Append-only event log capturing the outcome of every mirror attempt.
--    Used to gate rollout-stage decisions per feature_rollout_matrix.md §11
--    and mirror_observability.md §14. See docs/supabase/observability_sink.md
--    for design rationale, retention strategy, and open questions.
--
--    Strict exclusions (enforced by absence, not by CHECK):
--      - no payload column (payloads belong in mirror tables, not events)
--      - no source_hash column (deferred; see observability_sink.md §6)
--      - no user_id / auth coupling (deferred to Phase2)
--      - no IP / user-agent / browser fingerprint columns
CREATE TABLE mirror_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature         text        NOT NULL,
  mirror_status   text        NOT NULL,
  failure_reason  text,
  skip_reason     text,
  duration_ms     integer,
  environment     text        NOT NULL,
  schema_version  text,
  client_version  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mirror_events IS
  'Phase1 best-effort observability sink for mirror attempts. Append-only. '
  'No PII, no payload. The application layer (TypeScript MirrorResult unions) '
  'is the source of truth for valid enum values; this table accepts any text '
  'to keep enum evolution doc-first. See docs/supabase/observability_sink.md.';

COMMENT ON COLUMN mirror_events.feature IS
  'Short feature label (e.g. "studentProfile", "basicInfo"). Matches '
  'feature_rollout_matrix.md Feature/Domain identifiers.';

COMMENT ON COLUMN mirror_events.mirror_status IS
  'One of "success" | "failure" | "skipped" | "disabled" '
  '(mirror_observability.md §7). No DB-side CHECK by design — see §6 of the '
  'observability sink doc.';

COMMENT ON COLUMN mirror_events.failure_reason IS
  'Set when mirror_status = "failure". One of mirror_observability.md §8 '
  'reasons. NULL otherwise.';

COMMENT ON COLUMN mirror_events.skip_reason IS
  'Set when mirror_status = "skipped". One of mirror_observability.md §9 '
  'reasons. NULL otherwise.';

COMMENT ON COLUMN mirror_events.duration_ms IS
  'Mirror attempt duration in milliseconds. NULL acceptable for pre-flight '
  'skips that short-circuit before timing begins.';

COMMENT ON COLUMN mirror_events.environment IS
  'One of "development" | "preview" | "production". Operator decides how to '
  'partition rollout-stage queries by environment.';

COMMENT ON COLUMN mirror_events.schema_version IS
  'Mirror payload contract version that produced this event. Helps separate '
  'events caused by contract drift from events caused by infrastructure.';

COMMENT ON COLUMN mirror_events.client_version IS
  'App build identifier (commit hash / release tag). Lets operators '
  'correlate spikes in failure rate to deploys.';


-- 6. RLS — INSERT-only for anon. No SELECT / UPDATE / DELETE policy: the
--    application can only append, and reads happen via service-role context
--    in the Supabase SQL editor. This mirrors the no-reads / no-destructive
--    contract of student_profile_mirrors.
ALTER TABLE mirror_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mirror_events anon insert"
  ON mirror_events
  FOR INSERT
  TO anon
  WITH CHECK (true);


-- 7. Second feature mirror table — basicInfo.
--    Same shape as student_profile_mirrors (`<feature>_mirrors` convention
--    + jsonb payload + sha256 source_hash conflict key). Mirror helper:
--      lib/supabase/mirrorBasicInfo.ts
--    Design rationale: docs/supabase/basic_info_mirror_schema_preview.md
--
--    PII contract enforced by the mirror helper, not by SQL:
--      - `name` is stripped from `payload` before INSERT (the only direct-PII
--        field on canonical BasicInfo).
--      - `source_hash` is derived over the post-strip payload, so `name`
--        cannot leak via hash either.
--    The COMMENT below restates the contract so an operator reading the
--    schema sees the rule without needing to open the mirror helper.
CREATE TABLE basic_info_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE basic_info_mirrors IS
  'Phase1 best-effort mirror sink for basicInfo. localStorage is canonical. '
  'No SELECT policy by design. PII rule: payload MUST NOT contain raw `name` '
  '— the mirror helper (lib/supabase/mirrorBasicInfo.ts) strips it before '
  'INSERT. See docs/supabase/basic_info_mirror_schema_preview.md.';

COMMENT ON COLUMN basic_info_mirrors.source_hash IS
  'sha256(JSON.stringify(payloadWithoutName) + schema_version). Computed by '
  'the mirror helper at write time; NOT present on the canonical BasicInfo '
  'type. Upsert conflict target.';

COMMENT ON COLUMN basic_info_mirrors.schema_version IS
  'basicInfo canonical shape version. Pinned to "1" at first apply. Bump '
  'when normalizeBasicInfo / pruneSubjectGrades change post-prune shape.';

COMMENT ON COLUMN basic_info_mirrors.payload IS
  'Opaque jsonb snapshot of post-prune BasicInfo MINUS `name`. MUST NOT '
  'contain raw user-supplied name. Phase1 has no query requirements; '
  'structured-column expansion is deferred to a later STEP.';


-- 8. Trigger: keep updated_at fresh on every UPDATE. Reuses the existing
--    set_updated_at() function defined for student_profile_mirrors (§3) so
--    the two mirror tables share UPDATE-side semantics.
CREATE TRIGGER basic_info_mirrors_set_updated_at
  BEFORE UPDATE ON basic_info_mirrors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 9. RLS — write-only access for the anon role.
--    INSERT + UPDATE are required because the mirror helper performs an
--    upsert (INSERT ... ON CONFLICT DO UPDATE). SELECT and DELETE policies
--    are intentionally not created so the database mirrors the Phase1
--    no-reads / no-destructive-rollback contract at the storage layer.
ALTER TABLE basic_info_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "basic_info_mirrors anon insert"
  ON basic_info_mirrors
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "basic_info_mirrors anon update"
  ON basic_info_mirrors
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);


-- 10. Third feature mirror table — diagnosis (受験タイプ診断).
--     Same shape as student_profile_mirrors / basic_info_mirrors
--     (`<feature>_mirrors` convention + jsonb payload + sha256 source_hash
--     conflict key). Mirror helper:
--       lib/supabase/mirrorDiagnosis.ts
--     Design rationale: docs/supabase/diagnosis_mirror_schema_preview.md
--
--     This is the **no-PII mirror precedent** in Phase1:
--       - `answers` are numeric indices into QUESTIONS option arrays — no
--         user free text.
--       - `resultType` is a fixed enum (1|2|3|4) deterministically computed
--         by calcResultType(answers).
--       - `resultTitle` / `resultDescription` are app-authored static
--         strings from the in-page RESULT_TYPES dictionary — not user data.
--       - No payload strip layer (unlike basic_info_mirrors which removes
--         `name`).
--
--     `source_hash` excludes `createdAt` / `resultTitle` / `resultDescription`
--     so identical retakes dedup and app-side copy edits do not force
--     schema_version bumps. See docs/supabase/diagnosis_mirror_schema_preview.md
--     §7-§8.
CREATE TABLE diagnosis_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE diagnosis_mirrors IS
  'Phase1 best-effort mirror sink for diagnosis (受験タイプ診断). '
  'localStorage is canonical. No SELECT policy by design. Payload carries '
  'NO user free text — answers are numeric indices, resultType is a fixed '
  'enum, resultTitle / resultDescription are app-authored static strings. '
  'No PII strip layer is required at the mirror helper. See '
  'docs/supabase/diagnosis_mirror_schema_preview.md.';

COMMENT ON COLUMN diagnosis_mirrors.source_hash IS
  'sha256(JSON.stringify({ answers, resultType }) + schema_version). '
  'Computed by lib/supabase/mirrorDiagnosis.ts at write time; NOT present '
  'on the canonical DiagnosisResult type. Upsert conflict target. '
  'createdAt / resultTitle / resultDescription are intentionally excluded '
  'from the hash so identical retakes dedup and app-supplied copy edits '
  'do not force schema_version bumps.';

COMMENT ON COLUMN diagnosis_mirrors.schema_version IS
  'diagnosis canonical shape version. Pinned to "1" at first apply. Bump '
  'triggers: QUESTIONS array changes (length / option order), '
  'DiagnosisType enum extends, or calcResultType logic changes. Title / '
  'description copy edits do NOT trigger a bump.';

COMMENT ON COLUMN diagnosis_mirrors.payload IS
  'Opaque jsonb snapshot of DiagnosisResult { resultType, resultTitle, '
  'resultDescription, answers, createdAt }. Stored verbatim — no strip, '
  'no normalize. App-authored title / description are durable historical '
  'snapshots and may differ from the current in-code RESULT_TYPES.';


-- 11. Trigger: keep updated_at fresh on every UPDATE. Reuses the existing
--     set_updated_at() function defined for student_profile_mirrors (§3)
--     and shared with basic_info_mirrors (§8) so all three mirror tables
--     share UPDATE-side semantics.
CREATE TRIGGER diagnosis_mirrors_set_updated_at
  BEFORE UPDATE ON diagnosis_mirrors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 12. RLS — write-only access for the anon role.
--     INSERT + UPDATE required for upsert (INSERT ... ON CONFLICT DO UPDATE).
--     SELECT / DELETE policies intentionally absent, matching the other
--     two mirror tables.
ALTER TABLE diagnosis_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diagnosis_mirrors anon insert"
  ON diagnosis_mirrors
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "diagnosis_mirrors anon update"
  ON diagnosis_mirrors
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);


-- 13. Fourth feature mirror table — activityData (活動整理).
--     Same shape as student_profile_mirrors / basic_info_mirrors /
--     diagnosis_mirrors (`<feature>_mirrors` convention + jsonb payload +
--     sha256 source_hash conflict key). Mirror helper:
--       lib/supabase/mirrorActivityData.ts
--     Design rationale: docs/supabase/activity_mirror_schema_preview.md
--
--     This is the **narrative-soft PII** mirror precedent:
--       - No direct-name PII field on `ActivityData` (no `name`-equivalent),
--         so `stripName`-style boundary enforcement does NOT apply here.
--       - Narrative free-text fields (`clubName`, `theme`, `description`,
--         `achievement`, `role`, `challenge`, `action`, `reflection`,
--         `futureConnection`, and their per-activity-type analogues) carry
--         contextual identity. Cannot be stripped without destroying the
--         artifact — the narrative IS the mirror's content.
--       - Phase1 anonymous posture rests on: (a) anon SELECT absent →
--         operator service-role only, (b) no `user_id` column → cross-row
--         linkage impossible, (c) anon UPDATE allowed for upsert idempotency.
--
--     Trigger contract — **submit-driven only**:
--       Mirror dispatch lives in `hooks/useActivityForm.ts:handleSubmit`,
--       NOT in `lib/activityStorage.ts:saveActivityData` (the autosave
--       path). Per-keystroke autosave generates 1000-5000 writes per
--       editing session; submit-driven keeps it to ~1 per session.
--       See STEP-PHASE1M decision and post-apply checklist §3.3 for the
--       typing-only verification used to detect a regression.
--
--     `source_hash` covers the FULL payload — unlike basic_info_mirrors
--     (which strips `name` first) and diagnosis_mirrors (which hashes
--     `{ answers, resultType }` only). Every narrative field is part of
--     content identity. See activity_mirror_schema_preview.md §7.
CREATE TABLE activity_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE activity_mirrors IS
  'Phase1 best-effort mirror sink for activityData (活動整理). localStorage '
  'is canonical. No SELECT policy by design. Payload carries no direct-name '
  'PII field but DOES carry user-authored narrative free text (clubName / '
  'activityContent / theme / description / achievement / role / challenge / '
  'action / reflection / futureConnection, etc.). Operator sign-off on the '
  'Phase1 anonymous-RLS exposure of these narratives is the gate that lets '
  'this table exist. See docs/supabase/activity_mirror_schema_preview.md §6.';

COMMENT ON COLUMN activity_mirrors.source_hash IS
  'sha256(JSON.stringify(payload) + schema_version). Computed by '
  'lib/supabase/mirrorActivityData.ts at write time over the FULL payload — '
  'unlike basic_info_mirrors (which strips `name` first) and diagnosis_mirrors '
  '(which hashes a subset). Every narrative field is part of content '
  'identity. Upsert conflict target.';

COMMENT ON COLUMN activity_mirrors.schema_version IS
  'activityData canonical shape version. Pinned to "1" at first apply. '
  'Bump triggers: adding/removing/renaming any of the 9 top-level arrays, '
  'any BaseActivity field, any feature-specific Activity type field, or '
  'the `type` discriminator. Validator changes (lib/activityValidator.ts) '
  'do NOT trigger a bump.';

COMMENT ON COLUMN activity_mirrors.payload IS
  'Opaque jsonb snapshot of the post-validate ActivityData (9 top-level '
  'arrays, each with feature-specific shape). Stored verbatim — no strip, '
  'no normalize, no sort. Shape MUST match what lib/aiInputHash.ts consumes '
  'to keep AI cache hashes stable across canonical and mirror.';


-- 14. Trigger: reuses the shared set_updated_at() function defined in §3
--     and used by §8 / §11 so all four mirror tables share UPDATE-side
--     semantics.
CREATE TRIGGER activity_mirrors_set_updated_at
  BEFORE UPDATE ON activity_mirrors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 15. RLS — write-only access for the anon role.
--     INSERT + UPDATE required for upsert (INSERT ... ON CONFLICT DO UPDATE).
--     SELECT / DELETE policies intentionally absent, matching the other
--     three mirror tables.
ALTER TABLE activity_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_mirrors anon insert"
  ON activity_mirrors
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "activity_mirrors anon update"
  ON activity_mirrors
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
