/** A 2px bar along the card's bottom edge. `fraction` 0..1; only the width moves (300-400 ms ease-out). */
export function ProgressBar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="hud-bar" data-progress="bar" data-value={pct}>
      <span className="hud-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A dot stepper ("n of m", 2 to 8 dots): dots up to and including `index` are filled, the rest are rings. */
export function Steps({ total, index }: { total: number; index: number }) {
  const n = Math.max(2, Math.min(8, total));
  const dots = [];
  for (let i = 0; i < n; i++) dots.push(<span key={i} className={i <= index ? 'hud-steps__dot hud-steps__dot--on' : 'hud-steps__dot'} />);
  return (
    <div className="hud-steps" data-progress="steps" data-index={index} data-total={n}>
      {dots}
    </div>
  );
}
