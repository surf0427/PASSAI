// Exam Spine — Tutor canary containment QA（Phase 3.5 real-canary closure）。
//
// 目的:
//   「canary を 1 ユーザーだけに限定できる」ことを機械的に保証する。
//   実 rollout の前に、**閉じ込めが本当に効くか**をここで確定させる。
//
//   lib/tutor/spineContextFlag.ts は default deny を前提に書かれているが、
//   default deny は「env を間違えたときに OFF に倒れる」ことが本体であり、
//   その性質は実際に不正値を入れてみないと検証できない。
//
// 検証する性質:
//   1. 未設定 / 空 / 不正値 はすべて OFF（fail closed）
//   2. 許可値（'true' / '1' / 'yes'、trim + 大文字小文字無視）だけが ON
//   3. allowlist 未設定なら flag ON の全ユーザーが ON
//   4. allowlist 設定時は **列挙した userId だけ** ON。他は必ず OFF
//   5. userId 空は常に OFF（判定不能を ON にしない）
//   6. allowlist の空白・空要素で誤って全開放しない
//
// 厳守:
//   - process.env を書き換えるが、実行後に必ず復元する。
//   - 外部通信ゼロ / DB アクセスゼロ（flag は純粋な env 判定）。
//   - 実ユーザー ID を埋め込まない（合成 UUID のみ）。
//
// 使い方: npm run qa:examSpine:tutorCanary

const FLAG = 'TUTOR_SPINE_CONTEXT_ENABLED';
const LIST = 'TUTOR_SPINE_CONTEXT_USER_IDS';

const USER_A = '11111111-1111-1111-1111-111111111111'; // canary 対象
const USER_B = '22222222-2222-2222-2222-222222222222'; // 対象外（巻き込まれてはいけない）

type Case = {
  name: string;
  flag: string | undefined;
  list: string | undefined;
  userId: string;
  expected: boolean;
};

const CASES: readonly Case[] = [
  // 1. default deny
  { name: 'flag 未設定', flag: undefined, list: undefined, userId: USER_A, expected: false },
  { name: 'flag 空文字', flag: '', list: undefined, userId: USER_A, expected: false },
  { name: 'flag 空白のみ', flag: '   ', list: undefined, userId: USER_A, expected: false },
  { name: "flag 'false'", flag: 'false', list: undefined, userId: USER_A, expected: false },
  { name: "flag '0'", flag: '0', list: undefined, userId: USER_A, expected: false },
  { name: "flag 'no'", flag: 'no', list: undefined, userId: USER_A, expected: false },
  { name: "flag 'on'（許可値ではない）", flag: 'on', list: undefined, userId: USER_A, expected: false },
  { name: "flag 'truthy'（部分一致で通さない）", flag: 'truthy', list: undefined, userId: USER_A, expected: false },

  // 2. 許可値
  { name: "flag 'true'", flag: 'true', list: undefined, userId: USER_A, expected: true },
  { name: "flag '1'", flag: '1', list: undefined, userId: USER_A, expected: true },
  { name: "flag 'yes'", flag: 'yes', list: undefined, userId: USER_A, expected: true },
  { name: "flag 'TRUE'（大文字）", flag: 'TRUE', list: undefined, userId: USER_A, expected: true },
  { name: "flag ' true '（前後空白）", flag: ' true ', list: undefined, userId: USER_A, expected: true },

  // 3. allowlist 未設定 = 制限なし
  { name: 'allowlist 未設定 → 別ユーザーも ON', flag: 'true', list: undefined, userId: USER_B, expected: true },
  { name: 'allowlist 空文字 → 制限なし', flag: 'true', list: '', userId: USER_B, expected: true },
  { name: 'allowlist 空白のみ → 制限なし', flag: 'true', list: '  ', userId: USER_B, expected: true },
  { name: 'allowlist カンマのみ → 制限なし', flag: 'true', list: ',,,', userId: USER_B, expected: true },

  // 4. ★ 1 ユーザー限定（本 QA の中心）
  { name: '★ allowlist に載っている user は ON', flag: 'true', list: USER_A, userId: USER_A, expected: true },
  { name: '★ allowlist に載っていない user は OFF', flag: 'true', list: USER_A, userId: USER_B, expected: false },
  { name: '★ allowlist 空白込みでも一致する', flag: 'true', list: ` ${USER_A} `, userId: USER_A, expected: true },
  { name: '★ allowlist 複数のうち 1 つ一致', flag: 'true', list: `${USER_A},${USER_B}`, userId: USER_B, expected: true },
  { name: '★ allowlist あり + flag OFF は ON にならない', flag: 'false', list: USER_A, userId: USER_A, expected: false },

  // 5. userId 空
  { name: 'userId 空 → OFF', flag: 'true', list: undefined, userId: '', expected: false },
  { name: 'userId 空 + allowlist → OFF', flag: 'true', list: USER_A, userId: '', expected: false },

  // 6. 前方一致・部分一致で漏れない
  { name: 'allowlist 部分文字列では一致しない', flag: 'true', list: USER_A.slice(0, 8), userId: USER_A, expected: false },
];

async function main(): Promise<void> {
  const { isTutorSpineContextEnabled, tutorContextMode } = await import(
    '@/lib/tutor/spineContextFlag'
  );

  const savedFlag = process.env[FLAG];
  const savedList = process.env[LIST];

  let failures = 0;
  try {
    for (const c of CASES) {
      if (c.flag === undefined) delete process.env[FLAG];
      else process.env[FLAG] = c.flag;
      if (c.list === undefined) delete process.env[LIST];
      else process.env[LIST] = c.list;

      const actual = isTutorSpineContextEnabled(c.userId);
      if (actual === c.expected) {
        console.log(`  OK    ${c.name.padEnd(44)} -> ${actual}`);
      } else {
        console.error(
          `  FAIL  ${c.name.padEnd(44)} -> ${actual}（期待 ${c.expected}）`,
        );
        failures += 1;
      }
    }

    // mode enum が観測ログ用の 2 値だけであること。
    if (tutorContextMode(true) !== 'spine_only' || tutorContextMode(false) !== 'legacy') {
      console.error('  FAIL  tutorContextMode の enum が想定外');
      failures += 1;
    } else {
      console.log('  OK    tutorContextMode enum（legacy / spine_only）');
    }
  } finally {
    // 実行環境を汚さない。
    if (savedFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = savedFlag;
    if (savedList === undefined) delete process.env[LIST];
    else process.env[LIST] = savedList;
  }

  console.log('');
  if (failures > 0) {
    console.error(`[exam-spine-tutor-canary-qa] CHECK FAIL（${failures} 件）`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[exam-spine-tutor-canary-qa] CHECK PASS（${CASES.length} cases。default deny と 1 ユーザー限定が成立）`,
  );
}

void main();
