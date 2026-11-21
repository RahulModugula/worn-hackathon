import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImpactPage } from './ImpactPage';
import { MODEL, PUBLISHED } from './sources';

afterEach(cleanup);

describe('/impact page', () => {
  it('renders every section and the synthetic-demo footer', () => {
    render(<ImpactPage />);
    expect(screen.getByRole('heading', { level: 1, name: /Hospitals pay for minutes/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Calculator' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Where the numbers come from' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Use-case map' })).toBeTruthy();
    expect(screen.getByText('Synthetic demo. Figures are published estimates or labelled assumptions.')).toBeTruthy();
  });

  it('derives the headline price from inputs and shows the arithmetic', () => {
    render(<ImpactPage />);
    // 139,497 / (173 x 720) = 1.11992 -> $1.12
    expect(screen.getByText(/A nurse-minute is worth ~\$1\.12\./)).toBeTruthy();
    const math = screen.getByTestId('headline-math');
    expect(math.textContent).toContain('$139,497 loaded cost');
    expect(math.textContent).toContain('173 shifts');
    expect(math.textContent).toContain('720 min');
    expect(math.textContent).toContain('$1.12');
  });

  it('shows a Sourced, Estimate or Assumption tag on every statistic row', () => {
    const { container } = render(<ImpactPage />);
    for (const s of [...PUBLISHED, ...MODEL]) {
      const row = container.querySelector(`[data-stat="${s.id}"]`);
      expect(row, `row for ${s.id}`).not.toBeNull();
      expect(row!.textContent).toContain(s.badge[0] + s.badge.slice(1).toLowerCase());
      expect(row!.textContent).toContain(s.value);
    }
    for (const s of PUBLISHED) {
      expect(s.badge).toBe('SOURCED');
      expect(s.source.length).toBeGreaterThan(0);
    }
    expect(PUBLISHED.map((s) => s.id)).toEqual(
      expect.arrayContaining(['docHours', 'medError', 'barcode', 'turnover', 'rnJobs', 'hospitals']),
    );
    expect(container.querySelectorAll('.im-badge-sourced').length).toBe(PUBLISHED.length);
  });

  it('labels the loaded cost as an ESTIMATE and the scenario inputs as ASSUMPTIONs', () => {
    render(<ImpactPage />);
    const cost = screen.getByLabelText('Loaded cost per nurse per year').closest('.im-field')!;
    expect(cost.textContent).toContain('Estimate');
    const price = screen.getByLabelText('Device price').closest('.im-field')!;
    expect(price.textContent).toContain('Assumption');
  });

  it('lists the use cases with BUILT and NEXT status and the same-kit note', () => {
    const { container } = render(<ImpactPage />);
    expect(container.querySelectorAll('.im-badge-built').length).toBe(2);
    expect(container.querySelectorAll('.im-badge-next').length).toBe(4);
    expect(screen.getByText(/src\/hud-kit/)).toBeTruthy();
    expect(screen.getByText(/days, not months/)).toBeTruthy();
  });

  it('gives every input a label, decimal keyboard mode and 16px text', () => {
    render(<ImpactPage />);
    for (const label of ['Nurses per unit', 'Device price', 'Capture rate', 'Shifts per year', 'Beds per nurse on shift']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.getAttribute('inputmode')).toBe('decimal');
    }
  });

  it('shows the per-nurse value once: it is the same number as value per device-year', () => {
    render(<ImpactPage />);
    const text = screen.getByLabelText('Outputs').textContent ?? '';
    expect(text.split('$1,453')).toHaveLength(2); // exactly one occurrence
    expect(text).toContain('value per device-year');
  });

  it('changing an input updates the outputs', () => {
    render(<ImpactPage />);
    const outputs = screen.getByLabelText('Outputs');
    expect(outputs.textContent).toContain('$1,453');
    expect(outputs.textContent).toContain('3.7 months');

    fireEvent.change(screen.getByLabelText('Minutes saved per shift'), { target: { value: '30' } });
    // 30 x 139,497 / 720 x 0.5 = 2,906.19
    expect(outputs.textContent).toContain('$2,906');
    expect(outputs.textContent).toContain('1.9 months');
    expect(outputs.textContent).not.toContain('3.7 months');
  });

  it('guards divide-by-zero: zero minutes gives n/a payback, zero price gives a free device', () => {
    render(<ImpactPage />);
    fireEvent.change(screen.getByLabelText('Minutes saved per shift'), { target: { value: '0' } });
    expect(screen.getByLabelText('Outputs').textContent).toContain('n/a');

    fireEvent.change(screen.getByLabelText('Minutes saved per shift'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Device price'), { target: { value: '0' } });
    expect(screen.getByLabelText('Outputs').textContent).toContain('0 (free device)');
  });

  it('flags an out-of-range input and uses the clamped value', () => {
    render(<ImpactPage />);
    const input = screen.getByLabelText('Minutes saved per shift');
    fireEvent.change(input, { target: { value: '5000' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/Out of range\. Using 720/)).toBeTruthy();
  });

  it('shows the hospital scenario devices from the beds-per-nurse assumption', () => {
    render(<ImpactPage />);
    expect(screen.getByLabelText('Outputs').textContent).toContain('100');
    fireEvent.change(screen.getByLabelText('Beds per nurse on shift'), { target: { value: '4' } });
    // 500 / 4 = 125
    expect(screen.getByLabelText('Outputs').textContent).toContain('125');
  });
});

describe('/impact running costs and wording', () => {
  it('has editable running-cost and device-life inputs, labelled as assumptions', () => {
    render(<ImpactPage />);
    const run = screen.getByLabelText(/Running cost per device per year/).closest('.im-field')!;
    expect(run.textContent).toContain('Assumption');
    expect(run.textContent).toMatch(/software|MDM|cleaning/i);
    expect(screen.getByLabelText('Device life')).toBeTruthy();
  });
  it('says "device-only payback" and "with running costs" and the number reacts to running cost', () => {
    render(<ImpactPage />);
    const outputs = screen.getByLabelText('Outputs');
    expect(outputs.textContent).toContain('Device-only payback');
    expect(outputs.textContent).toContain('Payback with running costs');
    const before = outputs.textContent;
    fireEvent.change(screen.getByLabelText(/Running cost per device per year/), { target: { value: '900' } });
    expect(outputs.textContent).not.toBe(before);
    fireEvent.change(screen.getByLabelText(/Running cost per device per year/), { target: { value: '999999' } });
    expect(outputs.textContent).toContain('never pays back');
  });
  it('explains where saved minutes become money, with the NSI turnover figure', () => {
    render(<ImpactPage />);
    const t = screen.getByTestId('minutes-to-money').textContent!;
    expect(t).toMatch(/overtime/i);
    expect(t).toMatch(/agency/i);
    expect(t).toContain('$60,090');
    expect(t).toContain('NSI 2026');
  });
});
