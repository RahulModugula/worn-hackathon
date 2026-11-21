import { useCallback, useMemo } from 'react';
import { getInstanceId, useSession } from '../../../hud-kit/sync/useSession';
import type { Action, SessionState } from '../../../../shared/types';
import type { ActionInput } from './model';

/** Thin app wrapper over the generic hud-kit session client. The only place that knows the WS URL. */
export interface SocketOptions {
  /** Ask the server for director capability (Director drawer). The server may still refuse without the right key. */
  director?: boolean;
  /** Matches the server's DIRECTOR_KEY, when one is set. */
  key?: string;
  /** This tab's instance id (server stamps it on actions; a handoff must be accepted on a different instance). */
  instance?: string;
}

export function sessionSocketUrl(
  sessionId: string,
  loc: Pick<Location, 'protocol' | 'host'> = window.location,
  opts: SocketOptions = {},
): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const extra = opts.director ? `&director=1${opts.key ? `&key=${encodeURIComponent(opts.key)}` : ''}` : '';
  const inst = opts.instance ? `&instance=${encodeURIComponent(opts.instance)}` : '';
  return `${proto}//${loc.host}/ws?session=${encodeURIComponent(sessionId)}&device=phone${extra}${inst}`;
}

function pageKey(): string | undefined {
  try { return new URLSearchParams(window.location.search).get('key') ?? undefined; } catch { return undefined; }
}

export function useBedsideSession(sessionId = 'demo', opts: SocketOptions = {}) {
  const director = opts.director === true;
  const url = useMemo(() => sessionSocketUrl(sessionId, window.location, { director, key: opts.key ?? pageKey(), instance: getInstanceId() }), [sessionId, director, opts.key]);
  const storageKey = `bedside-glance:phone:${sessionId}`;
  const s = useSession<SessionState, Action>({ url, storageKey });
  const { dispatch } = s;
  // hud-kit's Omit does not distribute over the Action union, so the typed input is cast once here.
  const send = useCallback(
    (a: ActionInput) => { dispatch(a as unknown as Omit<Action, 'clientEventId'>); },
    [dispatch],
  );
  return {
    state: s.state,
    offline: s.offline,
    forceOffline: s.forceOffline,
    conflicts: s.conflicts,
    presence: s.presence,
    lastResult: s.lastResult,
    setForceOffline: s.setForceOffline,
    clearConflicts: s.clearConflicts,
    send,
  };
}

export type BedsideSession = ReturnType<typeof useBedsideSession>;
