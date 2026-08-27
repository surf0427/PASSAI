// Exam Spine — Wave 2 収束 / Stage 4 readiness の機械チェック。
//
// 目的:
//   「Stage 4 を開始してよいか」を人間の感覚ではなく PASS / FAIL で判定できるようにする。
//   本 script が検証するのは **収束状態**であって Stage 4 の実装ではない。
//
// 検証軸:
//   R1  Decision Register が 1 本で、ID が一意・連番であること
//   R2  canonical lineage が単一（lib/examSpine/** に旧 lineage の contract が同居しない）
//   R3  purpose gate が全 purpose に宣言され、default deny が成立すること
//   R4  essay projection が bounded（本文が server projection に載らない）
//   R7  canonical namespace の path 衝突が無いこと
//   R8  Stage 2 contract が凍結され production runtime から import 0 本であること
//   R9  Stage 3 reader の mutation 不可能性 / service_role 不在 / import graph
//
//   R5（live schema）は scripts/exam-spine-live-schema-check.ts、
//   R6（authenticated SELECT policy）は supabase/exam_spine_rls_verification.sql が担当する。
//   いずれも外部依存があるため本 script では判定せず、判定手段だけを示す。
//
// 厳守: 外部通信ゼロ / DB アクセスゼロ / AI 呼び出しゼロ。static 検査と純関数のみ。
//
// 使い方: npm run qa:examSpine:readiness

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { EXAM_CONTEXT_PURPOSES } from '@/lib/examSpine/types';
import {
  EXAM_CONTEXT_REGISTRY,
  gateExamSourceKinds,
  sourcesForPurpose,
} from '@/lib/examSpine/purpose';
import { EXAM_SOURCE_KINDS, EXAM_SOURCE_TABLES } from '@/lib/examSpine/sourceData/types';
import * as Q from '@/lib/examSpine/read/queries';
import { EXAM_CONTEXT_BLOCK_REGISTRY } from '@/lib/examSpine/blocks/registry';
import { EXAM_PURPOSE_PLANS } from '@/lib/examSpine/orchestrator/plan';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

// ── R1. Decision Register ─────────────────────────────────────────────
function r1Register(): void {
  console.log('\nR1. Decision Register');
  const path = join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md');

  // ★ Register が **canonical tree 内**に 1 本しか無いこと（E-S37 / E-S38）★
  //   Stage 4 の分岐事故は「Register が 2 本に割れた」ことが起点だった。
  //   ID の一意性だけを見ても、Register 自体が複数あれば単一性は成立しない。
  //
  //   ⚠️ 責務分界（E-S38-4）:
  //     ここが検査するのは **今 checkout されている canonical tree** の状態だけである。
  //     別 branch に別の Register があることは違反ではない（runtime に同時存在しない）。
  //     non-canonical candidate branch を消さないと PASS しない設計にはしない。
  //     branch を跨いだ単一性は ancestry rule（STATE §1.1）が担保する。
  const specDir = join(ROOT, 'docs/principles/exam_spine');
  const registerFiles = readdirSync(specDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /^## E-[LSPH]\d+/m.test(readFileSync(join(specDir, f), 'utf8')));
  check(
    'Decision Register は canonical tree 内に 1 本だけ',
    registerFiles.length === 1 && registerFiles[0] === 'EXAM_SPINE_DECISIONS.md',
    registerFiles.join(', '),
  );

  // ★ canonical branch / HEAD の宣言が STATE に存在すること（E-S38）★
  //   Packet worker が「どの HEAD が canonical か」を推測せず解決できる状態を機械で守る。
  //   宣言が消えると canonical の所在が再び不明になるため FAIL にする。
  // ★ device claim の request transport は 1 本だけ（E-S39 / E-H7 の解決）★
  //   canonical namespace で HTTP header に束縛してよい device-claim module は
  //   sync/claim/** だけである。signal.ts へ header 定数 / Headers 依存を足すと
  //   wire format が 2 本になり、旧 client の hex を新 schema として誤解釈する
  //   経路（false-positive verified）が開く。構造的に禁止する。
  const spineFiles: string[] = [];
  (function collect(dir: string): void {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) collect(full);
      else if (full.endsWith('.ts')) spineFiles.push(full);
    }
  })(join(ROOT, 'lib/examSpine'));

  const headerBound = spineFiles.filter((f) => {
    const t = readFileSync(f, 'utf8');
    // HTTP header への束縛 = header 名定数 or Headers 型の受け取り
    return /_HEADER\s*=\s*'x-/.test(t) || /:\s*Headers\b/.test(t);
  }).map((f) => relative(ROOT, f)).sort();

  check(
    'device claim の request transport は sync/claim/** 1 本だけ',
    headerBound.every((f) => f.startsWith('lib/examSpine/sync/claim/')),
    headerBound.join(', '),
  );
  // ★ E-S55（human ruling / E-S39 を一部 supersede）★
  //   「header に束縛されていない」だけでは足りない。header を持たない **wire codec** が
  //   もう 1 本あるだけで、旧 client の hex を新 schema として誤解釈する経路が開く。
  //   したがって「active な device-claim wire codec は sync/claim/** だけ」を検査する。
  const wireCodecs = spineFiles
    .filter((f) => {
      const t = readFileSync(f, 'utf8');
      // wire version 定数を宣言し、かつ serialize / parse を export する module
      const declaresWireVersion = /_(?:CLAIM|SIGNAL)_VERSION\s*=\s*'/.test(t);
      const exportsCodec = /export function (?:serialize|parse)[A-Za-z]*\s*\(/.test(t);
      return declaresWireVersion && exportsCodec;
    })
    .map((f) => relative(ROOT, f))
    .sort();
  check(
    'active な device-claim wire codec は sync/claim/** だけ（E-S55）',
    wireCodecs.every((f) => f.startsWith('lib/examSpine/sync/claim/')),
    wireCodecs.join(', '),
  );

  // ★ E-S33 が固定した wire 定数の **値** を pin する ★
  //   宣言の場所だけを見ていると、値の rename を検出できない。header 名や wire version を
  //   黙って変えると、既にデプロイ済みの client は旧 header を送り続け、server は
  //   1 件も claim を受け取らない。結果は全 kind `unclaimed` という **正常な状態**なので
  //   runtime では観測できない（fail-open が吸収する）。したがって値を契約として固定する。
  const claimTypes = readFileSync(join(ROOT, 'lib/examSpine/sync/claim/types.ts'), 'utf8');
  check(
    "E-S33: claim header 名が 'x-exam-spine-device-claim' で固定されている",
    /EXAM_DEVICE_CLAIM_HEADER\s*=\s*'x-exam-spine-device-claim'/.test(claimTypes),
  );
  check(
    "E-S33: wire version が 'edc1' で固定されている",
    /EXAM_DEVICE_CLAIM_VERSION\s*=\s*'edc1'/.test(claimTypes),
  );
  check(
    'E-S33: token pattern が efp1 の 64 hex で固定されている',
    /EXAM_DEVICE_CLAIM_TOKEN_PATTERN\s*=\s*\/\^efp1:\[0-9a-f\]\{64\}\$\//.test(claimTypes),
  );

  // ★ 退役した wire format が active code に残っていないこと（E-S55）★
  //   docs の歴史記述は許す。active code に残ることは許さない。
  const retiredWire: string[] = [];
  for (const dir of ['app', 'lib']) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    (function walk(d: string): void {
      for (const name of readdirSync(d)) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(full) && readFileSync(full, 'utf8').includes('esy1')) {
          retiredWire.push(relative(ROOT, full));
        }
      }
    })(base);
  }
  check(
    'active code に退役 wire format（esy1）が 0 箇所（E-S55）',
    retiredWire.length === 0,
    retiredWire.join(', '),
  );

  // ★ Stage 5 の最初の切替対象が動いていないこと（E-S40）★
  //   R5（E-S41）は essay の sync eligibility を開くだけで、最初の consumer を
  //   essay へ移すものではない。eligibility の解放が first-consumer 選定を
  //   書き換える drift を構造的に止める。
  const entryPath = join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STAGE5_ENTRY.md');
  if (existsSync(entryPath)) {
    const entryText = readFileSync(entryPath, 'utf8');
    check(
      'Stage 5 の最初の consumer は tutor のまま',
      /FIRST_STAGE5_CONSUMER\s*=\s*tutor\b/.test(entryText),
    );
    check(
      'Stage 5 の最初の slot は basic_info のまま',
      /FIRST_STAGE5_SLOT\s*=\s*basic_info\b/.test(entryText),
    );
  }

  const stateText = readFileSync(
    join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STATE.md'), 'utf8');
  check(
    'STATE が canonical implementation branch を宣言している',
    /\|\s*Canonical implementation branch\s*\|\s*`[^`]+`/.test(stateText),
  );
  check(
    'STATE が canonical ancestry root を宣言している',
    /\|\s*Canonical ancestry root\s*\|/.test(stateText),
  );

  const text = readFileSync(path, 'utf8');
  const ids = [...text.matchAll(/^## (E-[LSPH])(\d+)/gm)].map((m) => ({
    prefix: m[1],
    n: Number(m[2]),
    id: `${m[1]}${m[2]}`,
  }));

  const seen = new Set<string>();
  const dup: string[] = [];
  for (const { id } of ids) {
    if (seen.has(id)) dup.push(id);
    seen.add(id);
  }
  check('R1 Decision ID に重複が無い', dup.length === 0, dup.join(', '));

  for (const prefix of ['E-L', 'E-S', 'E-P', 'E-H']) {
    const ns = ids.filter((x) => x.prefix === prefix).map((x) => x.n);
    const sorted = [...ns].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => n === i + 1);
    check(`R1 ${prefix} が 1..${sorted.length} の連番`, contiguous, sorted.join(','));
    const declaredOrder = ns.join(',') === sorted.join(',');
    check(`R1 ${prefix} が昇順で並んでいる`, declaredOrder, ns.join(','));
  }

  // 本文で参照されている ID がすべて定義済みであること（幽霊参照の検出）。
  const referenced = new Set([...text.matchAll(/\bE-[LSPH]\d+\b/g)].map((m) => m[0]));
  const undefinedRefs = [...referenced].filter((r) => !seen.has(r));
  check('R1 未定義 Decision への参照が無い', undefinedRefs.length === 0, undefinedRefs.join(', '));

  // ★ S5-P11 追加: 参照の走査を **code / QA script** まで広げる ★
  //   従来は Register 本文だけを見ていたため、実装コメントや QA anchor に残った
  //   stale ID（再採番後の付け替え漏れ）を検出できなかった（負例で実測）。
  //   controlled consumer lineage は canonical の前進に合わせて 3 度再採番しており、
  //   付け替え漏れは「decision 参照が解決しない」という Register の前提を壊す。
  const codeRoots = ['lib/examSpine', 'lib/contextBuilders', 'lib/tutor', 'app/api/tutor', 'scripts'];
  const codeFiles: string[] = [];
  const walkTs = (dir: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(ROOT, dir));
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${dir}/${e}`;
      const full = join(ROOT, rel);
      if (statSync(full).isDirectory()) walkTs(rel);
      else if (/\.tsx?$/.test(e)) codeFiles.push(rel);
    }
  };
  for (const r of codeRoots) walkTs(r);
  check('R1 走査対象の code file がある（空回り検査でない）', codeFiles.length > 20, `${codeFiles.length} file`);
  const staleInCode: string[] = [];
  for (const rel of codeFiles) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/\bE-[LSPH]\d+\b/g)) {
      if (!seen.has(m[0])) staleInCode.push(`${rel}: ${m[0]}`);
    }
  }
  check('R1 code / QA script に未定義 Decision 参照が無い',
    staleInCode.length === 0, [...new Set(staleInCode)].slice(0, 10).join(' / '));

  // ★ S5-P11 追加: promotion 語彙の一貫性 ★
  //   「convergence branch へ統合した」と「canonical branch へ昇格した」を
  //   STATE が取り違えると、後続 packet が誤った前提で動く（実際に 1 度起きた）。
  //   controlled-switch lineage の行は CONVERGED_ON_LINEAGE を使い、
  //   canonical 昇格を断定する文字列を置かない。
  const stateSrc = readFileSync(join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_STATE.md'), 'utf8');
  //
  // ★ S5-P12 で向きが反転した ★
  //   controlled consumer lineage は canonical branch へ昇格した。したがって
  //   「まだ昇格していない」を pin し続けると **嘘を守る検査**になる。
  //   語彙規約の趣旨は「STATE の主張と canonical tree の実測が一致すること」なので、
  //   PROMOTED と書くなら **その成果物が実在すること**を検査する側へ切り替える。
  const PROMOTED_ROWS: Array<[string, readonly string[]]> = [
    ['exam-spine-s5p2-lineage-convergence',
      ['lib/contextBuilders/tutor/serverRead/reader.server.ts', 'lib/tutor/composeTutorPrompt.ts']],
    ['exam-spine-s5p3-basic-info-switch',
      ['lib/examSpine/context/slotSwitchGate.server.ts', 'lib/examSpine/context/tutorBasicInfoSlot.ts']],
    ['exam-spine-w1-packet-e',
      ['lib/contextBuilders/tutor/serverRead/reader.server.ts']],
  ];
  const PROMOTED_ARTIFACTS = new Map<string, readonly string[]>(PROMOTED_ROWS);
  for (const [branchRow, artifacts] of PROMOTED_ROWS) {
    const line = stateSrc.split('\n').find((l) => l.includes(branchRow) && l.startsWith('|')) ?? '';
    check(`R1 STATE: ${branchRow} の行がある`, line !== '');
    if (line === '') continue;
    const claimsPromoted = line.includes('PROMOTED');
    const claimsConverged = line.includes('CONVERGED_ON_LINEAGE');
    check(`R1 STATE: ${branchRow} の status が 1 つに定まっている`,
      claimsPromoted !== claimsConverged, line.slice(0, 120));
    // ★ PROMOTED を名乗るなら成果物が canonical tree に実在すること ★
    if (claimsPromoted) {
      for (const rel of artifacts) {
        check(`R1 ${branchRow} が PROMOTED を名乗る根拠 ${rel} が実在する`,
          existsSync(join(ROOT, rel)), rel);
      }
    }
  }

  // ★ 列挙されていない行が PROMOTED を名乗れないこと（negative control N11a）★
  //   上の loop は「知っている 3 行」しか見ないため、**別の branch 行**に
  //   PROMOTED と書けば無検査で通ってしまった。branch 表を全走査し、
  //   PROMOTED を名乗る行は必ず根拠（実在する成果物）を宣言していることを要求する。
  //   cherry-pick 昇格のように file が増えない場合も、
  //   canonical に実在する成果物（decision 登録など）を 1 つ挙げること。
  const CHERRY_PICK_PROMOTED = new Map<string, string>([
    // ancestry には入らないが内容は canonical に存在する（E-S41 として登録済み）。
    ['exam-spine-w5-r5-evidence', 'E-S41'],
  ]);
  for (const line of stateSrc.split('\n')) {
    const m = /^\|\s*`(exam-spine-[\w.-]+)`\s*\|/.exec(line);
    if (!m || !line.includes('PROMOTED')) continue;
    const row = m[1];
    const known = PROMOTED_ARTIFACTS.has(row) || CHERRY_PICK_PROMOTED.has(row);
    check(`R1 PROMOTED を名乗る ${row} は根拠が登録されている`, known,
      'PROMOTED_ROWS / CHERRY_PICK_PROMOTED のどちらにも無い');
    const decId = CHERRY_PICK_PROMOTED.get(row);
    if (decId) {
      check(`R1 ${row} の昇格根拠 ${decId} が canonical Register に実在する`, seen.has(decId));
    }
  }
  // controlled consumer switch の 2 slot が canonical tree で実際に配線されていること。
  const promotedRoute = readFileSync(join(ROOT, 'app/api/tutor/route.ts'), 'utf8');
  for (const slot of ['tutor.basic_info', 'tutor.activity']) {
    check(`R1 canonical route が ${slot} の gate を評価している`,
      promotedRoute.includes(`isExamSpineSlotSwitchEnabled('${slot}'`));
  }
  // ★ Stage 5.9 を巻き戻していないこと（合流で最も壊れやすい点）★
  check('R1 canonical tree に presentation の canonical 射影が存在する',
    existsSync(join(ROOT, 'lib/examSpine/context/presentationProjection.ts')));
  check('R1 canonical tree に presentation 正規化の共有正本が存在する',
    existsSync(join(ROOT, 'lib/contextBuilders/tutorPresentationSection.ts')));
  check('R1 E-S54 は presentation のまま（controlled lineage が奪っていない）',
    /^## E-S54 — `presentation`/m.test(text));

  // ── R1b: STATE の readiness 宣言が code の実装と矛盾しない（N10）────────
  //
  // ★ 負例で見つかった穴 ★ STATE の statement_review semantics を DEFERRED から
  //   READY へ **文書だけ**書き換える mutation が、どの suite でも検出されなかった。
  //   readiness の enum は code 側（sync/verdict.ts / registry の blocker）が pin して
  //   いたが、**STATE 文書の宣言**は誰も見ていなかった。
  //   product 判断待ちの kind を文書上だけ READY にすると、後続 packet が
  //   「もう繋いでよい」と誤読する。宣言と実装のどちらか一方だけが動くのを止める。
  //
  //   ★ 文字列の存在確認で終わらせない ★
  //     needle を置いただけでは「READY と書いた行を別に足す」逃げ道が残る。
  //     したがって (1) DEFERRED 宣言が在ること (2) 同じ subject を READY と
  //     宣言する行が **無い**こと (3) code 側の実体が一致すること の 3 点で閉じる。
  const READINESS_PINS: ReadonlyArray<{
    readonly label: string;
    readonly section: string;
    readonly required: readonly string[];
    readonly forbidden: readonly RegExp[];
  }> = [
    {
      label: 'statement_review',
      section: '### statement_review readiness',
      required: [
        'semantics  DEFERRED（E-S49 classification C）',
        'overall    DEFERRED',
      ],
      // 同 section 内で semantics / overall を READY と宣言し直していないこと。
      forbidden: [/^\s*semantics\s+READY\b/m, /^\s*overall\s+READY\b/m],
    },
    {
      label: 'essay',
      section: '### essay readiness',
      required: ['runtime enable  BLOCKED  EXAM_SYNC_RUNTIME_ENABLE_BLOCKED.essay'],
      forbidden: [/^\s*runtime enable\s+READY\b/m],
    },
  ];
  for (const pin of READINESS_PINS) {
    const at = stateSrc.indexOf(pin.section);
    check(`R1b STATE: ${pin.label} の readiness 節がある`, at !== -1, pin.section);
    if (at === -1) continue;
    // 次の '### ' 見出しまでを当該 section とする（他 kind の行を巻き込まない）。
    const nextAt = stateSrc.indexOf('\n### ', at + pin.section.length);
    const section = stateSrc.slice(at, nextAt === -1 ? stateSrc.length : nextAt);
    for (const needle of pin.required) {
      check(`R1b STATE: ${pin.label} の宣言「${needle.slice(0, 40)}」が保たれている`,
        section.includes(needle), needle);
    }
    for (const re of pin.forbidden) {
      check(`R1b STATE: ${pin.label} の節が ${String(re)} を宣言していない`,
        !re.test(section));
    }
  }
  // ★ 宣言の相手側（実装）も同時に見る ★
  //   E-S49 が禁じているのは **tutor-facing な** canonical block であって、
  //   statement_review kind の block 一般ではない（`previous_output_summary` は
  //   divergence 探索 context 用で、tutor plan には載っていない）。
  //   したがって「tutor plan に statement_review 由来の block が無い」で閉じる。
  const blockRegistry = EXAM_CONTEXT_BLOCK_REGISTRY as unknown as
    Record<string, { sourceKind?: string }>;
  const tutorPlanBlocks = EXAM_PURPOSE_PLANS.tutor.blocks.map((b) => b.id);
  check('R1b tutor plan に statement_review 由来の block は無い（E-S49 semantics DEFERRED）',
    tutorPlanBlocks.every((id) => blockRegistry[id]?.sourceKind !== 'statement_review'),
    tutorPlanBlocks.join(','));
  check('R1b 対照: statement_review kind の block 自体は存在する（空回り検査でない）',
    Object.values(blockRegistry).some((b) => b.sourceKind === 'statement_review'));
  //   essay の runtime blocker は宣言だけでなく registry 実体も要る（両側で閉じる）。
  const registrySrc = readFileSync(
    join(ROOT, 'lib/examSpine/sync/adapters/registry.ts'), 'utf8');
  check('R1b essay の runtime blocker が registry に実在する',
    /EXAM_SYNC_RUNTIME_ENABLE_BLOCKED[\s\S]{0,400}?\n  essay:/.test(registrySrc));

  // ── R1c: module が「意味的に正しい」decision ID を引いている（N13）──────
  //
  // ★ 負例で見つかった穴 ★ 上の staleInCode 検査は **未定義 ID** しか見ない。
  //   promotion lineage の decision は canonical の未使用 ID へ 3 度再採番されており、
  //   旧 ID はすべて **実在する別の decision** になった。したがって
  //   `E-S49` を `E-S54` のような実在 ID へ差し替えても未定義参照検査は通ってしまう。
  //   そこで「どの module / どの subject が、どの ID を根拠にするか」の対応を pin する。
  //
  //   (1) module → 自分の主題の decision ID
  for (const [rel, id] of [
    ['lib/examSpine/context/tutorBasicInfoSlot.ts', 'E-S56'],
    ['lib/examSpine/context/tutorActivitySlot.ts', 'E-S58'],
    ['lib/examSpine/read/rowMappers.ts', 'E-S57'],
    ['lib/examSpine/read/guards.ts', 'E-S57'],
  ] as const) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    check(`R1c ${rel} は ${id} を引いている`, src.includes(id), rel);
  }
  //   (2) ID → 見出しの主題（ID が別 decision を指すようになっていない）
  for (const [id, needle] of [
    ['E-S49', 'statement_review'],
    ['E-S50', 'device history window'],
    ['E-S52', '`essay` の read window'],
    ['E-S54', '`presentation`'],
    ['E-S55', '`edc1`'],
    ['E-S56', 'tutor `basic_info` の consumer 切替'],
    ['E-S57', '生 `preferences` slot'],
    ['E-S58', 'tutor `activity` を 2 番目の controlled consumer 切替'],
  ] as const) {
    const head = text.split('\n').find((l) => l.startsWith(`## ${id} `)) ?? '';
    check(`R1c ${id} の見出しが期待の主題`, head.includes(needle), head.slice(0, 110));
  }
  //   (3) subject → ID（STATE / 実装が引く根拠の向きを固定する）
  //       readiness 宣言が「実在するが別主題の ID」へ張り替えられても落ちる。
  const SEMANTIC_REFS: ReadonlyArray<readonly [string, string, string]> = [
    // [label, その主張が書かれている文脈, 期待する decision ID]
    ['statement_review semantics DEFERRED', 'semantics  DEFERRED（', 'E-S49'],
    ['essay semantics DEFERRED', 'semantics       DEFERRED ★ ', 'E-S53'],
    ['essay transport BLOCKED', 'transport       BLOCKED  ★ ', 'E-S52'],
  ];
  for (const [label, ctx, id] of SEMANTIC_REFS) {
    const at = stateSrc.indexOf(ctx);
    check(`R1c STATE: ${label} の文脈がある`, at !== -1, ctx);
    if (at === -1) continue;
    const line = stateSrc.slice(at, stateSrc.indexOf('\n', at));
    check(`R1c STATE: ${label} の根拠は ${id}`, line.includes(id), line.slice(0, 110));
  }

  // Wave 2 で登録した decision が実在すること。
  for (const id of ['E-S23', 'E-S24', 'E-S25', 'E-S26', 'E-S27', 'E-S28', 'E-P9']) {
    check(`R1 ${id} が登録済み`, seen.has(id));
  }
  // E-H2 は canonical Register 上で RESOLVED であること（shipping からの統合）。
  const eh2 = text.slice(text.indexOf('## E-H2'), text.indexOf('## E-H3'));
  check('R1 E-H2 が canonical Register 上で RESOLVED', eh2.includes('`RESOLVED`'));

  // ── R6: authenticated SELECT policy の production evidence ─────────
  //
  // ★ 4 kind（self_prs / statement_review_history / essay_workspaces /
  //   interview_practice_records）は policy が無くても 200 + 0 行になり、
  //   runtime では検出できない。したがって Register 上に evidence が
  //   記録されていること自体を gate にする。
  const eh1 = text.slice(text.indexOf('## E-H1'), text.indexOf('## E-H2'));
  check('R6 E-H1 が RESOLVED', eh1.includes('`RESOLVED`'));
  for (const table of [
    'self_prs',
    'statement_review_history',
    'essay_workspaces',
    'interview_practice_records',
  ]) {
    check(`R6 ${table} の owner SELECT policy evidence が記録されている`,
      eh1.includes(`${table} owner select`), 'E-H1 に policy 名が無い');
  }
  check('R6 policy の qual が owner 条件として記録されている',
    (eh1.match(/\(auth\.uid\(\) = user_id\)/g) ?? []).length >= 4);
  check('R6 再検証手段（SQL）が保持されている',
    existsSync(join(ROOT, 'supabase/exam_spine_rls_verification.sql')));
}

// ── R2 / R7. canonical lineage / namespace ────────────────────────────
function r2Namespace(): void {
  console.log('\nR2 / R7. canonical lineage と namespace');
  const spineDir = join(ROOT, 'lib/examSpine');
  const files = walk(spineDir).map((f) => relative(ROOT, f));

  // 旧 lineage の contract が同居していないこと。
  const rejected = [
    'lib/examSpine/read/reader.server.ts',
    'lib/examSpine/read/snapshot.server.ts',
  ];
  const collided = rejected.filter((r) => files.includes(r));
  check('R2 旧 lineage の read 実装が canonical namespace に無い', collided.length === 0,
    collided.join(', '));

  // canonical 側の contract が揃っていること。
  const required = [
    'lib/examSpine/types.ts',
    'lib/examSpine/purpose.ts',
    'lib/examSpine/budget.ts',
    'lib/examSpine/sourceData/types.ts',
    'lib/examSpine/read/types.ts',
    'lib/examSpine/read/queries.ts',
    'lib/examSpine/read/readSources.ts',
    'lib/examSpine/read/requestSnapshot.server.ts',
    'lib/examSpine/read/supabaseExecutor.server.ts',
  ];
  const missing = required.filter((r) => !files.includes(r));
  check('R2 canonical contract が揃っている', missing.length === 0, missing.join(', '));

  // SourceState（旧 lineage の状態型）が canonical に混入していないこと。
  const withSourceState = files.filter((f) =>
    /export (type|const|function) (SourceState|SOURCE_ABSENT|SOURCE_UNAVAILABLE|sourceValueOrNull)/.test(
      readFileSync(join(ROOT, f), 'utf8'),
    ),
  );
  check('R7 旧 lineage の SourceState 契約が混入していない', withSourceState.length === 0,
    withSourceState.join(', '));
}

// ── R3. purpose gate ──────────────────────────────────────────────────
function r3PurposeGate(): void {
  console.log('\nR3. purpose gate');
  const kinds = new Set<string>(EXAM_SOURCE_KINDS);

  const noSources = EXAM_CONTEXT_PURPOSES.filter(
    (p) => !Array.isArray(EXAM_CONTEXT_REGISTRY[p].sources),
  );
  check('R3 全 purpose が sources を宣言', noSources.length === 0, noSources.join(', '));

  const badKinds: string[] = [];
  const badEvidence: string[] = [];
  for (const p of EXAM_CONTEXT_PURPOSES) {
    const policy = EXAM_CONTEXT_REGISTRY[p];
    for (const k of policy.sources) if (!kinds.has(k)) badKinds.push(`${p}:${k}`);
    const ev = Object.keys(policy.sourceEvidence).sort().join('|');
    const src = [...policy.sources].sort().join('|');
    if (ev !== src) badEvidence.push(p);
  }
  check('R3 sources が 10 kind の語彙のみ', badKinds.length === 0, badKinds.join(', '));
  check('R3 sourceEvidence が sources と 1:1', badEvidence.length === 0, badEvidence.join(', '));

  // default deny
  check('R3 未知 purpose は空（default deny）', sourcesForPurpose('nope').length === 0);
  check('R3 非文字列 purpose は空', sourcesForPurpose(null).length === 0);
  const g = gateExamSourceKinds('nope', ['basic_info']);
  check('R3 未知 purpose では全 kind が denied',
    g.allowed.length === 0 && g.denied.length === 1);

  // gate は拡張しない
  const g2 = gateExamSourceKinds('tutor', ['basic_info']);
  check('R3 gate は許可 kind を勝手に足さない', g2.allowed.length === 1);

  // 全 purpose の sources の和集合が 10 kind を超えない
  const union = new Set(EXAM_CONTEXT_PURPOSES.flatMap((p) => [...EXAM_CONTEXT_REGISTRY[p].sources]));
  check('R3 sources の和集合が 10 kind 以内', union.size <= EXAM_SOURCE_KINDS.length,
    `${union.size}`);
}

// ── R4. essay projection ──────────────────────────────────────────────
function r4EssayProjection(): void {
  console.log('\nR4. essay projection');
  const q = Q.essayQuery('00000000-0000-4000-8000-000000000000');
  check('R4 essay が bare workspace 列を SELECT しない', !q.columns.includes('workspace'),
    q.columns.join(', '));
  check('R4 essay が workspace->reviews へ絞っている',
    q.columns.some((c) => c === 'reviews:workspace->reviews'), q.columns.join(', '));

  const mapper = readFileSync(join(ROOT, 'lib/examSpine/read/rowMappers.ts'), 'utf8');
  check('R4 ExamEssayServerRow が bodyOnServer marker を持つ',
    /ExamEssayServerRow = \{\s*[\s\S]*?readonly bodyOnServer: false;/.test(mapper));
  check('R4 mapper が essayBodySnapshot を projection に載せない',
    !/essayBodySnapshot:/.test(mapper));
}

// ── R8 / R9. Stage 2 / Stage 3 の凍結条件 ─────────────────────────────
function r89Frozen(): void {
  console.log('\nR8 / R9. Stage 2 / Stage 3 の凍結条件');
  const spineFiles = walk(join(ROOT, 'lib/examSpine')).map((f) => relative(ROOT, f));

  // production runtime からの import が 0 本
  const appLib = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))]
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.startsWith('lib/examSpine/'));
  const importers = appLib.filter((f) =>
    /from\s+['"]@\/lib\/examSpine|import\(\s*['"]@\/lib\/examSpine/.test(
      readFileSync(join(ROOT, f), 'utf8'),
    ),
  );
  // ★ Stage 5.0（E-S33）で pilot 1 purpose の production 接続が入った。
  //   invariant は「0 本」から「allowlist ＋ prompt 経路の非接続」へ移る。
  const pilotImporters = ['app/tutor/page.tsx', 'app/api/tutor/route.ts'];
  const unexpected = importers.filter((f) => !pilotImporters.includes(f));
  check('R8 examSpine を import する production file は Stage 5.0 pilot だけ',
    unexpected.length === 0, unexpected.join(', '));

  const promptPath = appLib.filter((f) =>
    /^\s*import[^\n]*examSpine\/(blocks|orchestrator)/m.test(readFileSync(join(ROOT, f), 'utf8')));
  check('R8 Stage 2 の prompt 経路を production が import しない（consumer 未移行）',
    promptPath.length === 0, promptPath.join(', '));

  // ── mutation 不可能性 ───────────────────────────────────────────
  //
  // ★ `.delete(` を機械的に grep すると `WeakMap.delete()` / `Map.delete()` を
  //   DB mutation と誤検出する（requestSnapshot.server.ts / 旧 lineage の TTL cache）。
  //   検出したいのは「in-memory の delete があるか」ではなく
  //   「**DB へ到達しうる mutation があるか**」なので、構造で判定する:
  //
  //     1. Supabase client に触れられるのは .from( を持つ file だけ
  //     2. その file は supabaseExecutor.server.ts 1 本だけ
  //     3. その 1 本に mutation 動詞が無い
  //     4. 全 file で insert / upsert / rpc は 0（in-memory の同名 API が無いため誤検出しない）
  //
  //   これで「DB mutation は書く場所が構造的に無い」ことを示せる（E-S22）。
  const stripComments = (src: string): string =>
    src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  // ★ `.from(` も **受け手**で判定する（`.delete(` と同じ理由）★
  //   `Uint8Array.from()` / `Array.from()` は builtin の静的 factory であって
  //   PostgREST の table selector ではない。受け手を見ずに grep すると、
  //   Stage 4 の sync core（`lib/examSpine/sync/hash.ts` の UTF-8 encoder）のような
  //   純粋 module を「I/O 境界」と誤検出する。検出したいのは
  //   「**Supabase client に対する** .from(」だけなので、builtin の receiver を除外する。
  const BUILTIN_FROM_RECEIVERS = new Set([
    'Array', 'Object', 'String', 'Number', 'BigInt', 'Set', 'Map', 'Promise', 'Buffer',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
    'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  ]);
  const hasDbFrom = (code: string): boolean =>
    [...code.matchAll(/([A-Za-z0-9_$]+)\.from\(/g)].some(
      (m) => !BUILTIN_FROM_RECEIVERS.has(m[1]),
    );
  const withFrom = spineFiles.filter((f) => hasDbFrom(stripComments(readFileSync(join(ROOT, f), 'utf8'))));

  // negative control: builtin だけを除外していて、実際の client.from( は依然として捕まること。
  check('R9 [negative control] builtin factory は I/O 境界にならない',
    !hasDbFrom('const b = Uint8Array.from(out);\nconst a = Array.from(x);'));
  check('R9 [negative control] supabase client の .from( は捕まる',
    hasDbFrom('const q = client.from("self_prs").select("id");') &&
      hasDbFrom('await supabase.from(TABLE).upsert(row);'));
  check('R9 PostgREST を叩くのは supabaseExecutor.server.ts のみ',
    withFrom.length === 1 && withFrom[0].endsWith('read/supabaseExecutor.server.ts'),
    withFrom.join(', '));

  const executorSrc = withFrom.length === 1 ? stripComments(readFileSync(join(ROOT, withFrom[0]), 'utf8')) : '';
  check('R9 I/O 境界 file に mutation 動詞が無い',
    executorSrc.length > 0 && !/\.(insert|update|upsert|delete|rpc)\s*\(/.test(executorSrc));
  check('R9 I/O 境界 file は select から始まる query しか作らない',
    /\.from\([^)]*\)\.select\(/.test(executorSrc));

  const hardMutations: string[] = [];
  const serviceRole: string[] = [];
  const clientImports: string[] = [];
  for (const f of spineFiles) {
    if (!/\.ts$/.test(f)) continue;
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    // in-memory の同名 API が存在しない動詞だけを hard flag にする。
    if (/\.(insert|upsert|rpc)\s*\(/.test(code)) hardMutations.push(f);
    if (/service_role|SERVICE_ROLE|serviceRoleClient/.test(code)) serviceRole.push(f);
    // 値としての supabase client import（type-only は除く）。
    if (/^import\s+(?!type\b)[^;]*@supabase\/supabase-js/m.test(code)) clientImports.push(f);
  }
  check('R9 Spine に insert / upsert / rpc が 0 本', hardMutations.length === 0, hardMutations.join(', '));
  check('R9 Spine に service_role 参照が 0 本', serviceRole.length === 0, serviceRole.join(', '));
  check('R9 Spine が supabase client を値として import しない（type-only のみ）',
    clientImports.length === 0, clientImports.join(', '));

  // ExamReadQuery が SELECT 以外を表現できないこと（型で mutation を書けない）。
  const readTypes = stripComments(readFileSync(join(ROOT, 'lib/examSpine/read/types.ts'), 'utf8'));
  check('R9 ExamReadQuery の mode に mutation が無い',
    /mode:\s*'many'\s*\|\s*'maybeSingle'/.test(readTypes));

  // registry と query の table 整合
  const registered = new Set(Object.values(EXAM_SOURCE_TABLES).flat());
  const u = '00000000-0000-4000-8000-000000000000';
  const queries = [
    Q.basicInfoQuery(u), Q.activityQuery(u), Q.diagnosisQuery(u), Q.selfAnalysisQuery(u),
    Q.statementReviewQuery(u), Q.selfPrQuery(u), Q.essayQuery(u), Q.interviewRecordQuery(u),
    Q.interviewAiQuery(u), Q.presentationCoreQuery(u),
    Q.presentationAttemptsQuery(u, [u]), Q.presentationSessionsQuery(u, [u]),
  ];
  const unregistered = queries
    .flatMap((q) => [q.table, ...(q.embed ? [q.embed.table] : [])])
    .filter((t) => !registered.has(t));
  check('R9 query の table がすべて registry 内', unregistered.length === 0,
    [...new Set(unregistered)].join(', '));

  const noOwner = queries.filter(
    (q) => !q.filters.some((f) => f.op === 'eq' && f.column.endsWith('user_id')),
  );
  check('R9 全 query が owner filter を持つ', noOwner.length === 0,
    noOwner.map((q) => q.table).join(', '));
}

// ── coverage 情報（判定ではなく事実の提示）─────────────────────────────
function coverageInfo(): void {
  console.log('\nInfo. Stage 2 block の kind 被覆（判定ではない）');
  const registrySrc = readFileSync(join(ROOT, 'lib/examSpine/blocks/registry.ts'), 'utf8');
  const covered = EXAM_SOURCE_KINDS.filter((k) => registrySrc.includes(`sourceKind: '${k}'`));
  const uncovered = EXAM_SOURCE_KINDS.filter((k) => !covered.includes(k));
  console.log(`  info  block を持つ kind (${covered.length}): ${covered.join(', ')}`);
  console.log(`  info  block を持たない kind (${uncovered.length}): ${uncovered.join(', ')}`);
  console.log('  info  → consumer 移行（Stage 5/6）の前に対象 purpose の block を足すこと（E-S25）');
}

function main(): void {
  console.log('[exam-spine-readiness] Wave 2 収束 / Stage 4 readiness check');
  r1Register();
  r2Namespace();
  r3PurposeGate();
  r4EssayProjection();
  r89Frozen();
  coverageInfo();

  console.log(`\n[exam-spine-readiness] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-readiness] FAIL: ${failures.length} 件`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-readiness] PASS');
}

main();
