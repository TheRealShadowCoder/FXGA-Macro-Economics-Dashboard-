import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { name: string; children: ReactNode };
type State = { failed: boolean };

export class OptionalFeatureBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn(`[FXGA] optional feature isolated: ${this.props.name}`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
