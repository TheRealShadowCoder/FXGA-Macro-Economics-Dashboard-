import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null; resetKey: number };

function clearRuntimeCache() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('fxga:lkg:')) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch { /* Cache cleanup is best effort only. */ }
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FXGA UI recovered from a render failure', error, info.componentStack);
  }

  private retry = () => {
    clearRuntimeCache();
    this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
  };

  private reload = () => {
    clearRuntimeCache();
    window.location.reload();
  };

  render() {
    if (!this.state.error) return <div key={this.state.resetKey} className="fxga-app-runtime-root">{this.props.children}</div>;
    return (
      <main className="app-recovery" role="alert">
        <section className="app-recovery__panel">
          <p className="eyebrow">FX Global Avengers · Interface recovery</p>
          <h1>A view was isolated before it could blank the dashboard.</h1>
          <p>
            FXGA can retry with a clean runtime cache or reload against the current Cloudflare R0 / D1 data contract.
            Your authenticated member session is not removed by either action.
          </p>
          <div className="app-recovery__actions">
            <button type="button" className="bb-btn" onClick={this.retry}>Retry interface</button>
            <button type="button" className="bb-btn app-recovery__secondary" onClick={this.reload}>Clean reload</button>
          </div>
          <details>
            <summary>Technical detail</summary>
            <code>{this.state.error.message || 'Unknown render failure'}</code>
          </details>
        </section>
      </main>
    );
  }
}
