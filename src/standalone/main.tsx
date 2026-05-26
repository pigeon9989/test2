import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../expose/App';
import '../styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div
      style={{
        minHeight: '100vh',
        padding: '32px 24px 56px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <header
        style={{
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
          }}
        >
          STANDALONE PREVIEW
        </div>
        <h1
          style={{
            margin: 0, fontSize: 22, fontWeight: 600,
            color: 'var(--text)', letterSpacing: '-0.015em',
          }}
        >
          🍅 Pomodoro
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
          호스트 없이 모듈을 개발 미리보기. 호스트에 mount되면 SDK가 자동으로 연결됩니다.
        </p>
      </header>
      <App />
    </div>
  </StrictMode>,
);
