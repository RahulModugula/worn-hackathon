import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; /** Re-mount the children this long after a crash. 0 disables. Default 5000. */ retryMs?: number }
interface State { failed: boolean }

/** Last line of defence for the glasses and phone roots: a render error shows a calm message, never a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('bedside-glance render error', error instanceof Error ? error.message : 'unknown', info.componentStack?.split('\n')[1]?.trim() ?? '');
    const ms = this.props.retryMs ?? 5000;
    if (ms > 0) this.timer = setTimeout(() => this.setState({ failed: false }), ms);
  }

  componentWillUnmount(): void { if (this.timer) clearTimeout(this.timer); }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#000', color: '#fff', display: 'grid', placeItems: 'center', font: '20px system-ui, sans-serif' }}>
        <p role="status">Reconnecting…</p>
      </div>
    );
  }
}
