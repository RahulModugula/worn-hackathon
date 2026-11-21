import { useMemo, useState } from 'react';
import '../phone/tokens.css';
import './impact.css';
import { BrandMark } from '../phone/ui';
import {
  DEFAULTS,
  LIMITS,
  SHIFT_MINUTES,
  clampInput,
  computeOutputs,
  formatCount,
  formatMinutes,
  formatMonths,
  formatUsd,
  formatUsdCents,
  type CalcInputKey,
  type CalcInputs,
} from './calculator';
import { MODEL, PUBLISHED, badgeFor, type Badge, type Stat } from './sources';

const FIELDS: { key: CalcInputKey; label: string; hint: string; prefix?: string; suffix?: string }[] = [
  { key: 'nursesPerUnit', label: 'Nurses per unit', hint: 'Headcount on the unit' },
  { key: 'units', label: 'Units', hint: 'Med-surg units in the scenario' },
  { key: 'minutesPerShift', label: 'Minutes saved per shift', hint: 'No study yet', suffix: 'min' },
  { key: 'capturePct', label: 'Capture rate', hint: 'Share of saved minutes that become paid, reclaimed time', suffix: '%' },
  { key: 'devicePriceUsd', label: 'Device price', hint: 'Per device, USD', prefix: '$' },
  { key: 'loadedCostPerNurseYear', label: 'Loaded cost per nurse per year', hint: 'BLS RN wage x 1.43', prefix: '$' },
  { key: 'shiftsPerYear', label: 'Shifts per year', hint: 'About 2,080 hours at 12 h per shift' },
  { key: 'bedsPerNurseOnShift', label: 'Beds per nurse on shift', hint: 'Hospital scenario only' },
  { key: 'hospitalBeds', label: 'Hospital beds', hint: 'Scenario size' },
  { key: 'runningCostPerDeviceYear', label: 'Running cost per device per year', hint: 'Software + MDM + cleaning', prefix: '$' },
  { key: 'deviceLifeYears', label: 'Device life', hint: 'Years before replacement', suffix: 'yr' },
];

const USE_CASES: { name: string; status: 'BUILT' | 'NEXT'; text: string }[] = [
  { name: 'Med pass', status: 'BUILT', text: 'Scan the wristband. The glasses show the patient, the drug and the chart\'s own allergy list in the first second, hands free.' },
  { name: 'Wound photo handoff', status: 'BUILT', text: 'Capture at the bedside. The phone shows a side-by-side compare and a draft note for clinician review. It does not measure, stage or diagnose.' },
  { name: 'Shift handoff', status: 'NEXT', text: 'Outgoing bedside summary at a glance while the nurse walks the unit.' },
  { name: 'Rapid-response patient context', status: 'NEXT', text: 'Patient context at the bedside during a rapid-response call, hands busy.' },
  { name: 'Isolation and PPE, hands-free', status: 'NEXT', text: 'Checks and charting while gloved and gowned, without touching a device.' },
  { name: 'Home health visits', status: 'NEXT', text: 'The same chart-and-check flow for a visit outside the hospital.' },
];

function parseRaw(s: string): number {
  if (s.trim() === '') return 0;
  return Number(s.replace(/,/g, ''));
}

function Badge({ kind }: { kind: Badge | 'BUILT' | 'NEXT' }) {
  // Sentence case, quiet: the word is the signal, so no colour is needed to tell a sourced figure from an assumption.
  const text = kind[0] + kind.slice(1).toLowerCase();
  return <span className={`im-badge im-badge-${kind.toLowerCase()}`}>{text}</span>;
}

export function ImpactPage() {
  const [raw, setRaw] = useState<Record<CalcInputKey, string>>(() => {
    const init = {} as Record<CalcInputKey, string>;
    for (const k of Object.keys(DEFAULTS) as CalcInputKey[]) init[k] = String(DEFAULTS[k]);
    return init;
  });

  const inputs = useMemo<CalcInputs>(() => {
    const out = {} as CalcInputs;
    for (const k of Object.keys(DEFAULTS) as CalcInputKey[]) out[k] = parseRaw(raw[k]);
    return out;
  }, [raw]);

  const out = useMemo(() => computeOutputs(inputs), [inputs]);

  const headlinePrice = formatUsdCents(out.costPerNurseMinute);
  const loaded = clampInput('loadedCostPerNurseYear', inputs.loadedCostPerNurseYear);
  const shifts = clampInput('shiftsPerYear', inputs.shiftsPerYear);

  return (
    <div className="im-app">
      <main className="im-main">
        <header className="im-hero">
          <p className="im-kicker"><BrandMark size={24} />Bedside Glance · impact model</p>
          <h1 className="im-headline">
            <span>Hospitals pay for minutes.</span>{' '}
            <span className="im-accent">A nurse-minute is worth ~{headlinePrice}.</span>
          </h1>
          <p className="im-math" data-testid="headline-math">
            {formatUsd(loaded)} loaded cost ÷ ({formatCount(shifts)} shifts × {SHIFT_MINUTES} min) = {headlinePrice} per paid minute.
            <Badge kind="ESTIMATE" />
          </p>
          <p className="im-sub">
            Value is nurse time, reclaimed at the bedside. Change any number below. Nothing here measures
            clinical outcomes.
          </p>
        </header>

        <section className="im-section" aria-labelledby="calc-h">
          <h2 id="calc-h" className="im-h2">Calculator</h2>
          <div className="im-calc">
            <form className="im-inputs" aria-label="Inputs" onSubmit={(e) => e.preventDefault()}>
              {FIELDS.map((f) => {
                const [lo, hi] = LIMITS[f.key];
                const value = inputs[f.key];
                const clamped = clampInput(f.key, value);
                const adjusted = clamped !== value;
                const id = `in-${f.key}`;
                const hintId = `${id}-hint`;
                return (
                  <div className="im-field" key={f.key}>
                    <div className="im-field-head">
                      <label htmlFor={id} className="im-label">{f.label}</label>
                      <Badge kind={badgeFor(f.key)} />
                    </div>
                    <div className="im-input-wrap">
                      {f.prefix && <span className="im-affix" aria-hidden="true">{f.prefix}</span>}
                      <input
                        id={id}
                        className="im-input"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={raw[f.key]}
                        aria-describedby={hintId}
                        aria-invalid={adjusted}
                        onChange={(e) => setRaw((r) => ({ ...r, [f.key]: e.target.value }))}
                      />
                      {f.suffix && <span className="im-affix" aria-hidden="true">{f.suffix}</span>}
                    </div>
                    <p id={hintId} className="im-hint">
                      {adjusted
                        ? `Out of range. Using ${clamped.toLocaleString('en-US')} (allowed ${lo.toLocaleString('en-US')} to ${hi.toLocaleString('en-US')}).`
                        : f.hint}
                    </p>
                  </div>
                );
              })}
            </form>

            <dl className="im-outputs" aria-live="polite" aria-label="Outputs">
              <Out label="Annual value per nurse" value={formatUsd(out.valuePerNurseYear)} sub="One device per nurse, so this is also the value per device-year" />
              <Out label="Device-only payback" value={formatMonths(out.paybackMonthsPerDevice)} sub="Price only. Ignores software, MDM and cleaning" />
              <Out label="Payback with running costs" value={out.paybackMonthsWithRunning === null ? 'never pays back at these inputs' : formatMonths(out.paybackMonthsWithRunning)} sub="Price over monthly value minus running cost" />
              <Out label="Net value per device-year" value={formatUsd(out.netValuePerDeviceYear)} sub="Value minus running cost minus price spread over device life" />
              <Out label="Devices needed for the unit(s)" value={formatCount(out.devicesAllUnits)} sub={`${formatCount(out.devicesPerUnit)} per unit, one per nurse`} />
              <Out label="Total annual value, unit(s)" value={formatUsd(out.unitAnnualValue)} />
              <Out label="Devices for the hospital" value={formatCount(out.hospitalDevices)} badge="ASSUMPTION" sub="Beds ÷ beds per nurse on shift, one per nurse on shift" />
              <Out label="Total annual value, hospital" value={formatUsd(out.hospitalAnnualValue)} badge="ASSUMPTION" />
              <Out label="Break-even minutes per shift at this price" value={formatMinutes(out.breakEvenMinutesPerShift)} />
            </dl>
          </div>
        </section>

        <section className="im-section" aria-labelledby="money-h">
          <h2 id="money-h" className="im-h2">Where saved minutes become money</h2>
          <p className="im-small" data-testid="minutes-to-money">
            A saved minute is only money when it is turned into something the hospital pays for: fewer overtime hours,
            fewer agency or float hours, or more time kept for patient care. The capture rate above is that share.
            The bigger lever is retention: replacing one bedside RN costs about $60,090 (NSI 2026), so a unit that
            keeps even one nurse a year changes the sum. We have not measured either effect; both are for the pilot to test.
          </p>
        </section>

        <section className="im-section" aria-labelledby="src-h">
          <h2 id="src-h" className="im-h2">Where the numbers come from</h2>
          <p className="im-small">
            Sourced figures are published, with the URL text from our research notes. An estimate is our derivation.
            An assumption is a value you can change. It is not a finding.
          </p>
          <StatTable title="Published" stats={PUBLISHED} />
          <StatTable title="Model inputs" stats={MODEL} />
        </section>

        <section className="im-section" aria-labelledby="uc-h">
          <h2 id="uc-h" className="im-h2">Use-case map</h2>
          <ul className="im-cards">
            {USE_CASES.map((u) => (
              <li className="im-card" key={u.name}>
                <div className="im-card-head">
                  <h3 className="im-h3">{u.name}</h3>
                  <Badge kind={u.status} />
                </div>
                <p className="im-small">{u.text}</p>
              </li>
            ))}
          </ul>
          <p className="im-small im-note">
            Every use case runs on the same generic display kit (src/hud-kit), so each new one is a new screen
            and data adapter. The goal is days, not months. That is our estimate, not a measured result.
          </p>
          <p className="im-small im-note">
            Documentation and verification aid. The nurse decides. The chart&apos;s own allergy list is shown; nothing is blocked or overridden.
          </p>
        </section>

        <footer className="im-footer">
          <p>Synthetic demo. Figures are published estimates or labelled assumptions.</p>
        </footer>
      </main>
    </div>
  );
}

function Out({ label, value, sub, badge }: { label: string; value: string; sub?: string; badge?: Badge }) {
  return (
    <div className="im-out">
      <dt className="im-out-label">
        {label} {badge && <Badge kind={badge} />}
      </dt>
      <dd className="im-out-value">{value}</dd>
      {sub && <dd className="im-out-sub">{sub}</dd>}
    </div>
  );
}

function StatTable({ title, stats }: { title: string; stats: Stat[] }) {
  return (
    <table className="im-table">
      <caption className="im-caption">{title}</caption>
      <thead>
        <tr>
          <th scope="col">Figure</th>
          <th scope="col">Value</th>
          <th scope="col">Badge</th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.id} data-stat={s.id}>
            <td data-label="Figure">{s.label}</td>
            <td data-label="Value" className="im-num">{s.value}</td>
            <td data-label="Badge"><Badge kind={s.badge} /></td>
            <td data-label="Source">
              {s.source}
              {s.note && <span className="im-note-inline"> {s.note}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
