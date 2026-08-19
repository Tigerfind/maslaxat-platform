import React from 'react';
import { captureRenderError } from '../sentry';

/**
 * Ловит непойманные ошибки рендера, чтобы вместо белого экрана показать
 * аккуратный брендовый фолбэк с кнопкой перезагрузки.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    captureRenderError(error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        background: '#F5F1EB', padding: 24, fontFamily: '"Inter", sans-serif',
      }}>
        <div style={{
          fontSize: '2.5rem', fontWeight: 300, letterSpacing: '0.3em',
          color: '#B8956E', marginBottom: 8,
        }}>M</div>
        <div style={{ fontSize: 20, fontWeight: 500, color: '#1A1A1A', marginBottom: 8 }}>
          Что-то пошло не так
        </div>
        <div style={{ fontSize: 14, color: '#6B6B6B', maxWidth: 380, lineHeight: 1.5, marginBottom: 24 }}>
          Произошла непредвиденная ошибка. Попробуйте обновить страницу — данные не потеряны.
        </div>
        <button
          onClick={this.handleReload}
          style={{
            background: 'linear-gradient(135deg, #B8956E, #9A7B5A)', color: '#FFFFFF',
            border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 14, fontWeight: 500,
            letterSpacing: '0.05em', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Обновить страницу
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
