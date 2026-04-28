// Unit test for parseLineMessage. We need CLICKUP env vars set just for module load.
process.env.CLICKUP_API_TOKEN = 'pk_test';
process.env.CLICKUP_LIST_ID = '0';
process.env.PORT = '0';

const { parseLineMessage } = require('./index.js');

const cases = [];
const log = (label, ok, got, want) => {
  cases.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n  got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
};

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

let r;

r = parseLineMessage('ทำสไลด์นำเสนอ');
log('plain text -> name only',
  eq(r, { name: 'ทำสไลด์นำเสนอ', priority: undefined, due_date: undefined, time_estimate: undefined, tags: undefined }),
  r, { name: 'ทำสไลด์นำเสนอ' });

r = parseLineMessage('ทำสไลด์ #urgent !2026-05-15 @2h +q2 +sales');
log('full hybrid format',
  r.name === 'ทำสไลด์' && r.priority === 1 && r.due_date === '2026-05-15' && r.time_estimate === '2h' && eq(r.tags, ['q2','sales']),
  r, { name: 'ทำสไลด์', priority: 1, due_date: '2026-05-15', time_estimate: '2h', tags: ['q2','sales'] });

r = parseLineMessage('ส่งของ #high');
log('priority high', r.priority === 2, r.priority, 2);

r = parseLineMessage('โทรลูกค้า #low !พรุ่งนี้');
const tomorrow = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); })();
log('Thai relative date "พรุ่งนี้"',
  r.name === 'โทรลูกค้า' && r.priority === 4 && r.due_date === tomorrow,
  r, { name: 'โทรลูกค้า', priority: 4, due_date: tomorrow });

r = parseLineMessage('แจ้งเงิน !วันนี้');
const today = new Date().toISOString().slice(0,10);
log('Thai relative date "วันนี้"',
  r.due_date === today, r.due_date, today);

r = parseLineMessage('multi   spaces  ');
log('trims and collapses spaces', r.name === 'multi spaces', r.name, 'multi spaces');

r = parseLineMessage('only #urgent !2026-05-01 @1h +tag');
log('extracts everything, name remaining', r.name === 'only', r.name, 'only');

r = parseLineMessage('estimate test @90m');
log('@90m -> 90m', r.time_estimate === '90m', r.time_estimate, '90m');

r = parseLineMessage('estimate test @1.5h');
log('@1.5h -> 1.5h', r.time_estimate === '1.5h', r.time_estimate, '1.5h');

r = parseLineMessage('A #UrGeNt');
log('priority case-insensitive', r.priority === 1, r.priority, 1);

r = parseLineMessage('#urgent !2026-05-15');
log('only options, no name', r.name === '', r.name, '');

const failed = cases.filter(c => !c.ok).length;
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
