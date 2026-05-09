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
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 max-w-sm text-center space-y-4">
            <p className="text-gray-200 font-semibold text-sm">일시적인 오류가 발생했습니다</p>
            <p className="text-gray-500 text-xs leading-relaxed">
              아래 버튼을 눌러 복구하거나,<br />
              문제가 계속되면 페이지를 새로고침(F5)해 주세요.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors"
                onClick={() => this.setState({ error: null })}
              >
                복구 시도
              </button>
              <button
                className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg transition-colors"
                onClick={() => window.location.reload()}
              >
                새로고침
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
