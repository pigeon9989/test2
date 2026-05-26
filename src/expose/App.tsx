import { useEffect, useRef, useState } from 'react';

const FOCUS_SEC = 25 * 60;
const BREAK_SEC = 5 * 60;

type Phase = 'focus' | 'break';

function fmt(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('focus');
  const [remaining, setRemaining] = useState<number>(FOCUS_SEC);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    tickRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r > 1) return r - 1;
        // phase transition
        const nextPhase: Phase = phase === 'focus' ? 'break' : 'focus';
        const nextRemaining = nextPhase === 'focus' ? FOCUS_SEC : BREAK_SEC;
        // setCycles fires only after a full focus session.
        if (phase === 'focus') setCycles((c) => c + 1);
        setPhase(nextPhase);
        return nextRemaining;
      });
    }, 1000);
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, [running, phase]);

  const reset = () => {
    setRunning(false);
    setPhase('focus');
    setRemaining(FOCUS_SEC);
  };

  const totalSec = phase === 'focus' ? FOCUS_SEC : BREAK_SEC;
  const progress = 1 - remaining / totalSec;

  return (
    <section
      style={{
        padding: '1.5rem',
        borderRadius: 16,
        background: phase === 'focus'
          ? 'linear-gradient(135deg, #ffe9e9, #fff3f3)'
          : 'linear-gradient(135deg, #e6f4ff, #f0f9ff)',
        border: '1px solid #eee',
        maxWidth: 480,
        textAlign: 'center',
      }}
    >
      <h3 style={{ margin: 0 }}>🍅 Pomodoro</h3>
      <div style={{ marginTop: 4, color: '#555', fontSize: 13 }}>
        {phase === 'focus' ? '집중 시간' : '휴식 시간'} · 사이클 {cycles}
      </div>

      <div
        style={{
          margin: '24px auto 12px',
          width: 220,
          height: 220,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: `conic-gradient(${phase === 'focus' ? '#e53e3e' : '#2b6cb0'} ${progress * 360}deg, #eee 0deg)`,
        }}
      >
        <div
          style={{
            width: 188,
            height: 188,
            borderRadius: '50%',
            background: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 44,
            fontWeight: 600,
          }}
        >
          {fmt(remaining)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          onClick={() => setRunning((r) => !r)}
          style={{ padding: '0.55rem 1rem', background: '#2553f2', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600, minWidth: 100 }}
        >
          {running ? '일시정지' : '시작'}
        </button>
        <button
          onClick={reset}
          style={{ padding: '0.55rem 1rem', background: '#fff', color: '#444', border: '1px solid #d4d4dc', borderRadius: 10, cursor: 'pointer' }}
        >
          리셋
        </button>
      </div>
    </section>
  );
}
