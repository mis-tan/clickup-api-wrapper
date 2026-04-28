// Standalone unit test for the helper functions inside index.js.
// We re-declare them here (identical copy) to test logic in isolation.

function toUnixMs(dateInput, fieldName) {
  if (dateInput === undefined || dateInput === null || dateInput === '') return null;
  if (typeof dateInput === 'number') return dateInput;
  const ms = Date.parse(dateInput);
  if (Number.isNaN(ms)) {
    const err = new Error(`Invalid date for "${fieldName}": ${dateInput}`);
    err.statusCode = 400;
    throw err;
  }
  return ms;
}

function timeEstimateToMs(input) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input === 'number') return Math.round(input * 60 * 1000);
  const match = String(input).trim().match(/^(\d+(?:\.\d+)?)\s*(m|h)?$/i);
  if (!match) {
    const err = new Error(`Invalid time_estimate: ${input}`);
    err.statusCode = 400;
    throw err;
  }
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  const multiplier = unit === 'h' ? 60 * 60 * 1000 : 60 * 1000;
  return Math.round(value * multiplier);
}

const cases = [];
const log = (label, ok, got, want) => {
  cases.push({ label, ok, got, want });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`);
};

// --- toUnixMs ---
log('null input', toUnixMs(null, 'x') === null, toUnixMs(null, 'x'), null);
log('empty string', toUnixMs('', 'x') === null, toUnixMs('', 'x'), null);

const ymd = toUnixMs('2024-05-20', 'd');
log('YYYY-MM-DD parses', ymd === Date.UTC(2024, 4, 20), ymd, Date.UTC(2024, 4, 20));

const iso = toUnixMs('2026-05-20T17:00:00Z', 'd');
log('ISO 8601 parses', iso === Date.UTC(2026, 4, 20, 17, 0, 0), iso, Date.UTC(2026, 4, 20, 17, 0, 0));

log('numeric passthrough', toUnixMs(1700000000000, 'd') === 1700000000000, toUnixMs(1700000000000, 'd'), 1700000000000);

let threw = false;
try { toUnixMs('not-a-date', 'due_date'); } catch (e) { threw = e.statusCode === 400; }
log('invalid date throws 400', threw, threw, true);

// --- timeEstimateToMs ---
log('null estimate', timeEstimateToMs(null) === null, timeEstimateToMs(null), null);
log('number = minutes', timeEstimateToMs(90) === 90 * 60 * 1000, timeEstimateToMs(90), 90 * 60 * 1000);
log('"90m" = 90 min', timeEstimateToMs('90m') === 90 * 60 * 1000, timeEstimateToMs('90m'), 90 * 60 * 1000);
log('"2h" = 2 hours', timeEstimateToMs('2h') === 2 * 60 * 60 * 1000, timeEstimateToMs('2h'), 2 * 60 * 60 * 1000);
log('"1.5h" = 1.5 hours', timeEstimateToMs('1.5h') === 1.5 * 60 * 60 * 1000, timeEstimateToMs('1.5h'), 1.5 * 60 * 60 * 1000);

let estThrew = false;
try { timeEstimateToMs('garbage'); } catch (e) { estThrew = e.statusCode === 400; }
log('invalid estimate throws 400', estThrew, estThrew, true);

const failed = cases.filter(c => !c.ok).length;
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
