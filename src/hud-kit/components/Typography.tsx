import type { ReactNode } from 'react';
import { Icon, type HudIconName } from './Icon';

export interface RoleProps {
  children?: ReactNode;
  /** Leading filled icon. */
  icon?: HudIconName;
  /** Leading icon size in px (default 24; a hero-height icon is 36). */
  iconSize?: number;
  /** Right-aligned secondary text on the same line (metadata). */
  aside?: ReactNode;
  asideIcon?: HudIconName;
  /** Aside at body luminance (75%) instead of metadata (50%). */
  asideStrong?: boolean;
}

function role(cls: string) {
  return function Role({ children, icon, iconSize, aside, asideIcon, asideStrong }: RoleProps) {
    if (!icon && aside === undefined) return <div className={`hud-text ${cls}`}>{children}</div>;
    return (
      <div className="hud-line">
        {icon ? <span className="hud-line__icon"><Icon name={icon} size={iconSize} /></span> : null}
        <div className={`hud-text hud-line__text ${cls}`}>{children}</div>
        {aside !== undefined ? (
          <div className={asideStrong ? 'hud-line__aside hud-line__aside--strong' : 'hud-line__aside'}>
            {asideIcon ? <Icon name={asideIcon} /> : null}
            <div className="hud-text">{aside}</div>
          </div>
        ) : null}
      </div>
    );
  };
}

/** 20px / 700 / sentence case / 100%: the state name next to its shape. */
export const Label = role('hud-label');
/** 36px / 700 / 100%: the one hero value. */
export const Hero = role('hud-hero');
/** 22px / 600 / 75%. */
export const Body = role('hud-body');
/** 20px / 600 / 75%: the action the wearer can take. */
export const Hint = role('hud-hint');
/** 20px / 600 / 60%: metadata. */
export const Meta = role('hud-meta');
