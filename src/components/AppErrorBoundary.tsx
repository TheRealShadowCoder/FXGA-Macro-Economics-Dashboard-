import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FXGA UI recovered from a render failure', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#07090d', color: '#f3f4f6', padding: 24 }}>
        <section style={{ width: 'min(680px, 100%)', border: '1px solid rgba(212,175,55,.28)', borderRadius: 18, background: '#0b0f15', padding: 24, boxShadow: '0 28px 90px rgba(0,0,0,.45)' }}>
          <small style={{ color: '#d4af37', letterSpacing: '.12em', textTransform: 'uppercase' }}>FX Global Avengers · Interface Recovery</small>
          <h1 style={{ margin: '8px 0 10px', fontSize: 26 }}>The dashboard intercepted a view error.</h1>
          <p style={{ margin: '0 0 18px', color: '#9da4b0', lineHeight: 1.6 }}>The application will no longer fail to a blank screen. Reload the interface to reconnect to the latest Google Cloud data contract.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ border: '1px solid rgba(212,175,55,.5)', borderRadius: 10, background: 'rgba(212,175,55,.12)', color: '#f5e7b1', padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}
          >
            Reload FXGA
          </button>
          <details style={{ marginTop: 16, color: '#777f8c', fontSize: 11 }}>
            <summary>Technical detail</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{this.state.error.message}</pre>
          </details>
        </section>
      </div>
    );
  }
}
