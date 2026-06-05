# `lib/supabase/` — Supabase Client Boundary

This directory is the **only** place in the codebase that is allowed to construct
or expose a Supabase client. It implements the contract written in
[`docs/supabase/client_boundary.md`](../../docs/supabase/client_boundary.md) and
the runtime rules in
[`docs/supabase/phase1_runtime_strategy.md`](../../docs/supabase/phase1_runtime_strategy.md).

If you are about to import `@supabase/supabase-js` or `@supabase/ssr` from
anywhere else, stop and route through this boundary instead.

---

## Files

| File | Role |
| --- | --- |
| `env.ts` | Lazy, cached access to `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. The only module allowed to read `process.env.SUPABASE_*` / `process.env.NEXT_PUBLIC_SUPABASE_*`. `getSupabaseServiceRoleKey()` is server-only by virtue of `NEXT_PUBLIC_` absence (browser bundle always sees `undefined`); the actual consumer is `serviceRoleClient.ts`. |
| `browserClient.ts` | Browser-side Supabase client (anon, RLS-scoped). Module-level singleton via `getBrowserSupabaseClient()`. |
| `serverClient.ts` | Server-side Supabase client (SSR-safe, anon, RLS-scoped). Per-request scope via `getServerSupabaseClient()` (uses `next/headers` cookies). |
| `serviceRoleClient.ts` | **STEP-BILLING-02.** Server-only admin-scope Supabase client. `getServiceRoleSupabaseClient()` bypasses RLS — used by Stripe webhook to write `subscriptions` / `stripe_events` / `usage_records` / `profiles.plan`. Guards: `import 'server-only'` (build-time), `typeof window !== 'undefined'` throw (runtime), reads service-role key only via `env.ts:getSupabaseServiceRoleKey`. Never import from client modules; never use for user-scoped reads — use `browserClient` / `serverClient` instead. |
| `mirrorTypes.ts` | Type-only contract for mirror helpers: `MirrorResult` = `success` \| `skipped` \| `failed`, plus the `MirrorSkipReason` / `MirrorFailureReason` enums aligned with [`mirror_observability.md`](../../docs/supabase/mirror_observability.md) §8 / §9. No runtime, no Supabase imports. |
| `mirrorResult.ts` | Tiny constructors (`mirrorSuccess()` / `mirrorSkipped(reason)` / `mirrorFailed(reason, message?)`) wrapping the `mirrorTypes.ts` unions. Pure, no Supabase imports. Consumed by every feature mirror. |
| `mirrorGuard.ts` | Pure decision helpers (`isMirrorEnabled` / `shouldSkipMirror`). All inputs are passed in — no `process.env`, no Supabase, no localStorage, no feature knowledge. Each feature mirror calls `shouldSkipMirror` for the kill-switch → skip-reason mapping (window check stays inline to preserve priority). |
| `mirrorLogger.ts` | Dev-only `console.debug` mirror result logger; hard no-op in production. Coexists with `mirrorEventSink.ts` (durable downstream sink); the two are not replacements for each other. |
| `mirrorFinalize.ts` | Shared observability finalisation. Exports `finalize(feature, result)` (metric → log → emit ordering), `buildMirrorEvent(feature, result)`, `deriveEnvironment()`, `readClientVersion()`. Every feature mirror calls `finalize` as its single exit point so `mirror_events` rows stay coherent across mirrors. No Supabase reads, no feature knowledge. |
| `mirrorSourceHash.ts` | Shared SHA-256 hex helper (`sha256Hex(input)`). Used by feature mirrors that derive their own `source_hash` at write time (`mirrorBasicInfo`, `mirrorDiagnosis`). Browser-only (`crypto.subtle.digest`); callers short-circuit before non-browser code can reach it. No Supabase imports, no feature knowledge. |
| `mirrorStudentProfile.ts` | First feature mirror. `mirrorStudentProfileToSupabase(input)` — best-effort, never throws, returns `MirrorResult`. Goes through `browserClient` only. Holds a file-local `MIRROR_TABLE` constant (`student_profile_mirrors`). Wired via a dynamic import inside `lib/studentProfileStorage.ts` so server route bundles do not pull in the browser boundary. |
| `mirrorBasicInfo.ts` | Second feature mirror. `mirrorBasicInfoToSupabase(input)` — best-effort, never throws, returns `MirrorResult`. **Strips `name` before payload assembly** so raw user-supplied name never leaves the browser in Phase1 anonymous mode. Derives `source_hash` at write time via the shared `./mirrorSourceHash::sha256Hex` (basicInfo canonical type has no sourceHash field). Wired via dynamic import inside `lib/basicInfoStorage.ts`. Table (`basic_info_mirrors`) DDL is committed in `supabase/schema.sql` §7–§9 — see [`basic_info_mirror_schema_preview.md`](../../docs/supabase/basic_info_mirror_schema_preview.md). |
| `mirrorDiagnosis.ts` | Third feature mirror. `mirrorDiagnosisToSupabase(input)` — best-effort, never throws, returns `MirrorResult`. **No-PII mirror precedent** — payload (`DiagnosisResult`) carries zero user free-text (`answers` = numeric indices, `resultType` = fixed enum, `resultTitle`/`resultDescription` = app-authored static strings). No payload-strip layer required. Derives `source_hash` via shared `./mirrorSourceHash::sha256Hex` from `{ answers, resultType }` + `SCHEMA_VERSION`. Wired via dynamic import inside `lib/diagnosisStorage.ts`. Table (`diagnosis_mirrors`) DDL is committed in `supabase/schema.sql` §10–§12 — see [`diagnosis_mirror_schema_preview.md`](../../docs/supabase/diagnosis_mirror_schema_preview.md). |
| `mirrorActivityData.ts` | Fourth feature mirror. `mirrorActivityDataToSupabase(input)` — best-effort, never throws, returns `MirrorResult`. **Narrative-soft PII precedent** — no direct-name PII (no `stripName`-equivalent), but narrative free-text fields (`clubName`, `theme`, `description`, `achievement`, etc.) carry contextual identity. No strip layer because the narrative IS the artifact. Derives `source_hash` via shared `./mirrorSourceHash::sha256Hex` from the full `ActivityData` payload + `SCHEMA_VERSION`. **Submit-driven trigger** — wired via dynamic import inside `hooks/useActivityForm.ts:handleSubmit`, NOT inside the autosave `saveActivityData` path (STEP-PHASE1M decision, prevents per-keystroke mirror flood). Table (`activity_mirrors`) DDL is committed in `supabase/schema.sql` §13–§15 — see [`activity_mirror_schema_preview.md`](../../docs/supabase/activity_mirror_schema_preview.md). |
| `mirrorConfig.ts` | Global kill-switch (`isMirrorRuntimeEnabled()`). Reads `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED`; default-enabled when unset. Sole reader of that env var. |
| `mirrorMetrics.ts` | In-memory counters (`attempted` / `success` / `skipped` / `failed`). No persistence, no network, no localStorage, no external SDK. Reading requires an explicit `getMirrorMetricsSnapshot()` call. Counters aggregate across all feature mirrors — durable per-feature data lives in `mirror_events`. |
| `mirrorEventSink.ts` | Best-effort INSERT into the `mirror_events` observability table (`supabase/schema.sql §5`). Exports `emitMirrorEvent(event)`. Independent kill-switch via `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` (default-enabled when unset). No reads, never throws, no retries / batching / sampling. Invoked via `mirrorFinalize.finalize()` from every feature mirror. |
| `auth.ts` | **Phase2 Auth (STEP-AUTH-01).** Browser-only helper. `ensureAnonymousUser()` calls `supabase.auth.getUser()` and falls back to `supabase.auth.signInAnonymously()`. Returns `string \| null` (never throws; null on env-missing / API failure). The only place outside Supabase's own modules that touches `supabase.auth.*`. Consumed by `AuthProvider`. See [`docs/supabase/phase2_auth_boundary.md`](../../docs/supabase/phase2_auth_boundary.md). |
| `profile.ts` | **Phase2 Auth (STEP-AUTH-02).** Browser-only helper for the `profiles` table. Exports `loadProfile`, `ensureProfile`, `isDisplayUserIdTaken`, `saveDisplayUserId`. Reads + writes the canonical auth-side row (id = auth.uid()). Treats env-missing / Supabase failure as `null` (load/ensure) or `{ kind: 'error' }` (save). Unique-violation on display_user_id is translated to `{ kind: 'duplicate' }`. Owner key is always `auth.users.id`; `display_user_id` is display-only and **never** used as identity / FK / RLS subject. Table DDL: `supabase/schema.sql §16–§18`. Apply checklist: [`profiles_apply_checklist.md`](../../docs/supabase/profiles_apply_checklist.md). |

---

## Import rules

- `@supabase/*` packages may be imported **only** from files inside
  `lib/supabase/`. Anywhere else (`app/**/page.tsx`, `app/**/route.ts`,
  `components/**`, `hooks/**`, `lib/*Storage.ts`, feature modules, etc.) must
  go through this boundary's exported helpers.
- `createClient` / `createBrowserClient` / `createServerClient` calls outside
  this directory are an architectural violation and grounds to reject a PR.
- Reads of `process.env.NEXT_PUBLIC_SUPABASE_*` / `process.env.SUPABASE_*` are
  restricted to `env.ts`. Feature code must use the env helpers exported here
  (or, more usually, just consume the client getters).
- `browserClient.ts` is for client modules (`"use client"`, hooks, browser-only
  utilities). `serverClient.ts` is for server modules (route handlers, server
  components, server-only utilities). **Do not import one from the other**, and
  do not import either from the wrong environment — this is how server-only
  secrets leak into the browser bundle.

---

## Boundary ownership

- This directory is **infrastructure**. It does not know about StudentProfile,
  statement, matching, activity, essay, interview, or any other feature.
- All client configuration (auth flow, cookie handling, fetch overrides,
  kill-switch, observability hooks) is decided here. Feature code must not
  reconfigure or wrap the returned client.
- The clients are owned by the boundary, not by callers. Always re-call the
  getter on each use; never stash the client in a long-lived variable, React
  state, or module-level singleton outside this directory.

---

## Phase1 contract (current phase)

- **`localStorage` remains canonical.** `lib/*Storage.ts` is the single
  source of truth for all persisted state. Supabase has no canonical role yet.
- **No Supabase reads.** Phase1 forbids reading from Supabase entirely —
  including "fallback if localStorage is empty" patterns. See
  [`phase1_runtime_strategy.md §8`](../../docs/supabase/phase1_runtime_strategy.md).
- **Mirror writes are best-effort, fire-and-forget.** Mirror helpers run
  *after* a successful canonical write, never throw, toast, block UI, or
  invalidate caches. Failures are absorbed and reported to the observability
  sink. Observability is downstream of mirrors — feature code never depends
  on it.
- **Pages, routes, and components must not import Supabase directly.** Every
  page / route / component remains Supabase-free. Mirror helpers reach the
  boundary only via a `lib/*Storage.ts` layer using a dynamic `import()`
  (see `studentProfileStorage.ts`), which keeps the browser-only Supabase
  client out of server route bundles.

---

## Missing-env behavior

- `env.ts` returns `null` from `getSupabaseEnv()` / `getSupabaseUrl()` /
  `getSupabaseAnonKey()` when either var is unset. `isSupabaseEnvAvailable()`
  returns `false`. Nothing throws.
- `getBrowserSupabaseClient()` and `getServerSupabaseClient()` return `null`
  when env is missing. Callers must treat `null` as "mirror disabled — skip".
- This is the default state for local dev when `NEXT_PUBLIC_SUPABASE_*` is not
  configured. The app must continue to work identically.

---

## What this boundary deliberately does NOT do (yet)

- Four feature mirrors are wired today (`mirrorStudentProfile`,
  `mirrorBasicInfo`, `mirrorDiagnosis`, `mirrorActivityData`). Three PII
  patterns are now validated: direct-PII strip (basicInfo's `name`), no-PII
  (diagnosis), and narrative-soft PII (activityData — narrative IS the
  artifact, no strip applicable). Additional feature mirrors land in later
  STEPs per
  [`feature_rollout_matrix.md`](../../docs/supabase/feature_rollout_matrix.md).
  Shared observability primitives live in `mirrorFinalize.ts`; the kill-switch
  skip-reason mapping lives in `mirrorGuard.ts`; the SHA-256 hex helper lives
  in `mirrorSourceHash.ts`. Feature-specific concerns (table name, payload
  shape, PII rules, error mapping, trigger placement) remain in each
  `mirrorXxx.ts` file. activityData's mirror is **submit-driven** (wired
  from `hooks/useActivityForm.ts:handleSubmit`, not from the autosave
  path) — see STEP-PHASE1M trigger-decision rationale.
- No Supabase reads / fallbacks (Phase2 responsibility).
- Each feature mirror owns its own `MIRROR_TABLE` constant and `onConflict`
  column assumption. Other feature mirrors must not reach across these files;
  the table identifier is part of the per-feature contract.
- All four mirror table DDLs are committed in `supabase/schema.sql`:
  `student_profile_mirrors` (§2–§4), `mirror_events` (§5–§6),
  `basic_info_mirrors` (§7–§9), `diagnosis_mirrors` (§10–§12),
  `activity_mirrors` (§13–§15). The **apply against the running Supabase
  project is operator-driven** for each. Until each is applied, the
  corresponding mirror INSERTs fail silently and surface as
  `failure / network_error` rows in `mirror_events`; canonical UX is
  unaffected. Apply procedure and post-apply verification:
  [`basic_info_mirror_schema_preview.md`](../../docs/supabase/basic_info_mirror_schema_preview.md)
  / [`basic_info_post_apply_checklist.md`](../../docs/supabase/basic_info_post_apply_checklist.md)
  / [`diagnosis_mirror_schema_preview.md`](../../docs/supabase/diagnosis_mirror_schema_preview.md)
  / [`diagnosis_post_apply_checklist.md`](../../docs/supabase/diagnosis_post_apply_checklist.md)
  / [`activity_mirror_schema_preview.md`](../../docs/supabase/activity_mirror_schema_preview.md)
  / [`activity_post_apply_checklist.md`](../../docs/supabase/activity_post_apply_checklist.md).
- **Auth surface is intentionally minimal.** Phase2 Auth
  ([`docs/supabase/phase2_auth_boundary.md`](../../docs/supabase/phase2_auth_boundary.md))
  permits **only** the following beyond N=4 freeze:
  - anonymous session creation (`auth.ts:ensureAnonymousUser()`)
  - `currentUserId` exposure through `AuthProvider` (`useCurrentUserId()`)
  - profile auto-ensure on mount (`profile.ts:ensureProfile()`)
  - optional display_user_id management (`/account` page only)
  - optional email opt-in (`email.ts:requestEmailChange()` / `/account/email`
    page only) — requests an email change against `auth.users.email` via
    `supabase.auth.updateUser({ email })`; Supabase sends the standard
    confirmation mail and the new address is **not** persisted on
    `auth.users.email` until the user clicks the confirmation link. The UI
    treats success as "confirmation-sent", not "saved". **Does not** add
    columns to `profiles` (STEP-AUTH-EMAIL-OPTIN-01)

  Everything else stays forbidden:
  - **no auth gating** — features must not require login to render
  - **no login wall** — no modal / interstitial / redirect on existing pages
  - **no existing-feature UI blocking** based on auth state (志望理由書 /
    自己分析 / 小論文 / Tutor / mypage are auth-agnostic)
  - **no session-coupled rendering** — Server Components must not branch on
    `auth.uid()`; no SSR session reads
  - **no Stripe coupling** — `profiles.plan` is fixed at `'free'`; do not
    read or branch on plan from runtime
  - **no email-required flow** — no sign-up form, no email verification gate,
    no "register to continue" prompt (the `/account/email` page above is
    opt-in only — no banner, modal, or interstitial drives users to it)
  - **no existing-data user_id linking** — `lib/*Storage.ts` remains
    user_id-free; mirror tables remain user_id-free

The shape above is intentional: Phase1 fixes the mirror boundary first
so each new mirror commit cannot accidentally widen the architecture.
Phase2 Auth adds a strictly bounded identity layer on top **without
modifying** the N=4 mirror freeze.

---

## Phase1 Freeze Status

**Boundary is frozen at N=4** (`mirrorStudentProfile`, `mirrorBasicInfo`,
`mirrorDiagnosis`, `mirrorActivityData`). The freeze contract lives in
[`docs/supabase/phase1_boundary_freeze.md`](../../docs/supabase/phase1_boundary_freeze.md);
that file is the gate for any further change to this directory.

- **New mirrors require a dedicated design STEP.** Adding a fifth mirror is
  not a "drop in another file" change — the new feature must pass the Mirror
  Addition Gate ([freeze §5](../../docs/supabase/phase1_boundary_freeze.md)).
  PII pattern classification, submit-boundary identification, rollback path,
  and operator verification checklist must land before (or with) the mirror
  PR.
- **Abstraction is currently prohibited.** No `upsertMirror(table, payload)`
  helper, no shared `mirrorXxx` factory, no `mirrors/index.ts` aggregator.
  The duplicate skip → env check → client check → try/catch shape in each
  `mirrorXxx.ts` is intentional. Abstraction is gated by the Abstraction
  Threshold Rule ([freeze §6](../../docs/supabase/phase1_boundary_freeze.md))
  — currently `N>=5`, ≥3 fully identical logic blocks, confirmed future
  mirrors, an observed runtime bug caused by duplication, measurable diff
  reduction, and observability consistency that cannot be maintained
  manually. "DRY" / "aesthetics" / "pattern symmetry" are explicitly not
  valid motivations.
- **Runtime reads are intentionally absent.** No `.select(` against
  `mirror_*` tables anywhere in `lib/supabase/`. The mirror tables exist
  for `mirror_events` observability and Phase2/Phase3 future read paths;
  runtime code in this phase must not learn that those tables exist
  beyond the write call site.
- **This layer is operational infrastructure, not app state.** Features
  must not depend on mirror success for UX. The mirror's only consumer is
  the observability pipeline (`mirror_events`) and the operator running
  apply checklists in Supabase Studio. Removing the entire `lib/supabase/`
  directory must leave canonical UX behaviour bit-identical (modulo
  observability rows).

See [`docs/supabase/phase1_boundary_freeze.md`](../../docs/supabase/phase1_boundary_freeze.md)
for the full freeze contract, runtime invariants, accepted tradeoffs, and
allowed future directions for Phase2+.

---

## Phase2 Auth Status

**Auth boundary is intentionally minimal.** Phase2 Auth introduces a strictly
bounded identity layer on top of the N=4 mirror freeze. The contract lives in
[`docs/supabase/phase2_auth_boundary.md`](../../docs/supabase/phase2_auth_boundary.md);
that file is the gate for any further change to the auth surface.

- **Only two files participate in auth.** `auth.ts` (anonymous session
  creation) and `profile.ts` (profiles row + display_user_id). No other file
  in `lib/supabase/` reads `auth.users.id` or touches `supabase.auth.*`.
- **Owner key is always `auth.users.id` (= `auth.uid()`).** `display_user_id`
  is display-only — never used for RLS / FK / Stripe / save ownership.
- **The N=4 mirror freeze is untouched.** Phase2 Auth does **not** add
  `user_id` to any `mirrorXxx.ts`, does **not** add `user_id` columns to
  mirror tables, and does **not** modify mirror dispatch sites or RLS.
- **profiles must remain non-PII.** Adding email / school / real-name
  columns directly to `profiles` is forbidden. The two allowed paths are
  (a) a separate `profile_private` table with `auth.uid() = id` SELECT
  policy, or (b) a `SECURITY DEFINER` function for the specific lookup.
  See [`phase2_auth_boundary.md §5.3`](../../docs/supabase/phase2_auth_boundary.md).
- **Operator verification.** `profiles` DDL is committed in
  `supabase/schema.sql §16–§18`. Apply against the running project is
  operator-driven. Procedure + post-apply check:
  [`profiles_apply_checklist.md`](../../docs/supabase/profiles_apply_checklist.md).
  Until applied, `loadProfile` / `ensureProfile` / `saveDisplayUserId`
  return `null` / error and `/account` shows a save-failure state;
  every other page continues to render off `localStorage` canonical.

Auth surface extensions (new helpers in `auth.ts` / `profile.ts`, new
`profiles` columns, new `AuthProvider` hooks, calls to `useCurrentUserId()`
from feature pages) require a **doc-first PR** updating
`phase2_auth_boundary.md` before the runtime change lands.

---

## Environment switches

**Environment switches require redeploy.** `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED`
and `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` are `NEXT_PUBLIC_*` env vars,
which Next.js inlines into the client bundle at build time. Changing the value
in the Vercel dashboard alone does **not** affect running clients — a new build
(redeploy) is required for the change to take effect. Stale clients (mobile
tabs, PWA cache, bfcache) continue running the old bundle until they pull the
new deploy.

**Kill-switches are operational best-effort controls, not instant runtime
toggles.** Phase1 deliberately does not implement a runtime-readable feature
flag system (no Vercel KV, no Edge Config, no middleware, no polling). For
immediate hard-stop needs (e.g. PII exposure incident), the operator path is
Supabase-side (`DROP TABLE` / RLS policy removal), which propagates
independently of client deploys.

See [`docs/supabase/phase1_boundary_freeze.md §10 Operator Environment Contract`](../../docs/supabase/phase1_boundary_freeze.md)
for the canonical operator runbook, and
[`docs/supabase/phase1_boundary_pressure_audit.md §11 Environment Propagation Risk`](../../docs/supabase/phase1_boundary_pressure_audit.md)
for the pressure-side risk enumeration.
