import { Component, ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-6 max-w-md text-center space-y-3">
            <p className="text-red-400 font-semibold text-sm">렌더링 오류가 발생했습니다</p>
            <p className="text-gray-400 text-xs break-all">{this.state.error.message}</p>
            <button
              className="mt-2 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg transition-colors"
              onClick={() => this.setState({ error: null })}
            >
              다시 시도
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
