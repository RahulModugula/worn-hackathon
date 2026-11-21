import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Phone UI primitives (docs/DESIGN-SYSTEM.md section 5). Every colour, space and radius lives in tokens.css. */

export type Tone = 'neutral' | 'accent' | 'info' | 'warn' | 'danger';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Brand mark: a rounded square, four corner ticks (the HUD bracket motif) around one dot (the glance). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="ph-brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" style={{ fill: 'var(--surface-2)' }} />
      <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--accent)' }}>
        <path d="M9.5 14v-2.5a2 2 0 0 1 2-2H14M18 9.5h2.5a2 2 0 0 1 2 2V14M22.5 18v2.5a2 2 0 0 1-2 2H18M14 22.5h-2.5a2 2 0 0 1-2-2V18" />
      </g>
      <circle cx="16" cy="16" r="2.6" style={{ fill: 'var(--accent)' }} />
    </svg>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** 48 (default, thumb target) or 40 (dense rows; still above the 40 px floor). */
  size?: 48 | 40;
  icon?: IconName;
  block?: boolean;
}

export function Button({ variant = 'secondary', size = 48, icon, block, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx('ph-btn', `ph-btn-${variant}`, size === 40 && 'ph-btn-sm', block && 'ph-btn-block', className)} {...rest}>
      {icon && <Icon name={icon} size={20} />}
      {children}
    </button>
  );
}

export function Card({ as: Tag = 'div', className, children, ...rest }: { as?: 'div' | 'li' | 'section'; className?: string; children: ReactNode } & Record<string, unknown>) {
  return <Tag className={cx('ph-card', className)} {...rest}>{children}</Tag>;
}

export function StatusDot({ tone = 'neutral', hollow }: { tone?: Tone; hollow?: boolean }) {
  return <span className={cx('ph-dot', `ph-tone-${tone}`, hollow && 'ph-dot-hollow')} aria-hidden="true" />;
}

export function Chip({ tone = 'neutral', icon, children, className, ...rest }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string } & Record<string, unknown>) {
  return (
    <span className={cx('ph-chip', `ph-tone-${tone}`, className)} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </span>
  );
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
  return <span className={cx('ph-avatar', size === 'lg' && 'ph-avatar-lg')} aria-hidden="true">{initials}</span>;
}

export interface TabItem { id: string; label: string; icon: IconName; badge?: string }

export function TabBar({ items, active, onSelect }: { items: TabItem[]; active: string | null; onSelect: (id: string) => void }) {
  return (
    <nav className="ph-tabbar" aria-label="Main">
      {items.map(t => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            className={cx('ph-tab', on && 'ph-tab-on')}
            aria-current={on ? 'page' : undefined}
            onClick={() => onSelect(t.id)}
          >
            <span className="ph-tab-icon">
              <Icon name={t.icon} filled={on} />
              {t.badge && <span className="ph-tab-badge" role="img" aria-label={t.badge} />}
            </span>
            <span className="ph-tab-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal bottom sheet: scrim, handle, title row. Escape closes, focus moves in and returns, Tab stays inside. */
export function Sheet({ title, titleId, onClose, hideClose, className, children }: {
  title: string; titleId: string; onClose: () => void; hideClose?: boolean; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !node) return;
      const els = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
  }, []);

  return (
    <div className="ph-scrim" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className={cx('ph-sheet', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <span className="ph-sheet-handle" aria-hidden="true" />
        <div className="ph-sheet-head">
          <h2 id={titleId} className="ph-h2">{title}</h2>
          {!hideClose && <Button variant="ghost" size={40} onClick={onClose}>Close</Button>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A message toast. `role="alert"` for refusals and failures the nurse must see. */
export function Toast({ tone = 'warn', icon = 'alert', role, children }: { tone?: Tone; icon?: IconName; role?: 'alert' | 'status'; children: ReactNode }) {
  return (
    <p role={role} className={cx('ph-toast', `ph-tone-${tone}`)}>
      <Icon name={icon} size={20} />
      <span>{children}</span>
    </p>
  );
}

/** Circular countdown. Driven by the server's acceptedAtMs (remainingMs), so it never drifts from the real window. */
export function UndoRing({ remainingMs, secondsLeft, totalMs = 10_000 }: { remainingMs: number; secondsLeft: number; totalMs?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, remainingMs / totalMs));
  return (
    <span className="ph-ring" aria-hidden="true">
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle className="ph-ring-track" cx="22" cy="22" r={r} fill="none" strokeWidth="3" />
        <circle
          className="ph-ring-arc" cx="22" cy="22" r={r} fill="none" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 22 22)"
        />
      </svg>
      <span className="ph-ring-text"><span>{secondsLeft}</span><span className="ph-ring-unit"> s</span></span>
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ph-stat">
      <dt className="ph-stat-label">{label}</dt>
      <dd className="ph-stat-value">{value}</dd>
      {sub && <dd className="ph-stat-sub">{sub}</dd>}
    </div>
  );
}

/**
 * A due-time label. Neutral (fg, semibold, clock icon) normally; warn colour plus a triangle when 5 min or less
 * away or overdue. Green is reserved for done and connected, so it is never used for a countdown.
 */
export function DueText({ mins, children, className }: { mins: number | null; children: ReactNode; className?: string }) {
  const urgent = mins !== null && mins <= 5;
  return (
    <span className={cx('ph-when', urgent && 'ph-when-warn', className)}>
      <Icon name={urgent ? 'alert' : 'clock'} size={16} />
      <span>{children}</span>
    </span>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string }) {
  return <span className="ph-skel" style={{ height, width }} aria-hidden="true" />;
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ph-empty">
      <span className="ph-empty-icon"><Icon name={icon} size={28} /></span>
      <h2 className="ph-empty-title">{title}</h2>
      {children && <p className="ph-empty-body">{children}</p>}
      {action}
    </div>
  );
}

/** The verification chain as connected steps, e.g. Wristband matched, Nurse confirmed, Server accepted. */
export function VerificationSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="ph-steps-chain" aria-label="Verification steps">
      {steps.map(s => (
        <li key={s} className="ph-step">
          <span className="ph-step-node"><Icon name="check" size={12} /></span>
          <span className="ph-step-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}
