import { useEffect, useMemo, useRef, useState } from 'react';
import { platform } from '../platform';

// Module-local narrow-viewport hook — modules deploy independently of the
// host so we don't share `useIsMobile` between them.
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const fn = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return narrow;
}

/* ─── Constants ─── */

interface Preset {
  id: string;
  label: string;
  focus: number;     // seconds
  short: number;     // seconds
  long: number;      // seconds
  longEvery: number; // every N focus cycles
}

const PRESETS: Preset[] = [
  { id: 'classic',  label: '25 / 5',  focus: 25 * 60, short:  5 * 60, long: 15 * 60, longEvery: 4 },
  { id: 'long',     label: '50 / 10', focus: 50 * 60, short: 10 * 60, long: 30 * 60, longEvery: 2 },
  { id: 'sprint',   label: '15 / 3',  focus: 15 * 60, short:  3 * 60, long: 10 * 60, longEvery: 4 },
  { id: 'deep',     label: '90 / 20', focus: 90 * 60, short: 20 * 60, long: 30 * 60, longEvery: 2 },
];

type Phase = 'focus' | 'short-break' | 'long-break';

interface CompletedSession {
  id: string;
  phase: Phase;
  durationSec: number;
  endedAt: number;
  preset: string;
}

const STORAGE_KEY = 'pomodoro/state';

const PHASE_LABEL: Record<Phase, string> = {
  'focus':       '집중 시간',
  'short-break': '짧은 휴식',
  'long-break':  '긴 휴식',
};
const PHASE_EYEBROW: Record<Phase, string> = {
  'focus':       'FOCUS',
  'short-break': 'SHORT BREAK',
  'long-break':  'LONG BREAK',
};

// Format a millisecond duration as `MM:SS.mmm`. The 3-digit fractional
// seconds make the timer feel alive instead of ticking once per second.
function fmt(ms: number) {
  const total = Math.max(0, ms);
  const m  = Math.floor(total / 60000).toString().padStart(2, '0');
  const s  = Math.floor((total % 60000) / 1000).toString().padStart(2, '0');
  const ml = Math.floor(total % 1000).toString().padStart(3, '0');
  return `${m}:${s}.${ml}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PersistedState {
  presetId: string;
  cycles: number;
  history: CompletedSession[];
}

/* ─── Component ─── */

export default function App() {
  const [presetId, setPresetId] = useState<string>('classic');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;

  const [phase, setPhase] = useState<Phase>('focus');
  // All time state is in **milliseconds** so the UI can show fractional
  // seconds. `preset.focus` etc. are still seconds in the table; we
  // multiply by 1000 wherever they meet the timer.
  const [remaining, setRemaining] = useState<number>(preset.focus * 1000);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const [history, setHistory] = useState<CompletedSession[]>([]);
  const [hosted, setHosted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const tickRef = useRef<number | null>(null);
  // Wall-clock anchor so the timer doesn't drift on slow frames or when the
  // tab is throttled in the background — we always recompute remaining from
  // (endAt - now) instead of subtracting tick intervals.
  const endAtRef = useRef<number | null>(null);
  const narrow = useIsNarrow();

  /* Hydrate */
  useEffect(() => {
    setHosted(platform.connected);
    void platform.storage.get<PersistedState>(STORAGE_KEY).then((s) => {
      if (s && typeof s === 'object') {
        if (typeof s.presetId === 'string' && PRESETS.find((p) => p.id === s.presetId)) {
          setPresetId(s.presetId);
        }
        if (typeof s.cycles === 'number') setCycles(s.cycles);
        if (Array.isArray(s.history)) setHistory(s.history);
      }
      setHydrated(true);
    });
  }, []);

  /* Persist */
  useEffect(() => {
    if (!hydrated) return;
    void platform.storage.set(STORAGE_KEY, { presetId, cycles, history } satisfies PersistedState);
  }, [presetId, cycles, history, hydrated]);

  /* Reset on preset change while idle */
  useEffect(() => {
    if (!running) {
      setPhase('focus');
      setRemaining(preset.focus * 1000);
      endAtRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  /* Tick — 50ms cadence anchored to wall-clock so the ms display doesn't
     drift when the tab is throttled or the renderer skips frames. */
  useEffect(() => {
    if (!running) {
      endAtRef.current = null;
      return;
    }
    if (endAtRef.current === null) {
      endAtRef.current = Date.now() + remaining;
    }
    tickRef.current = window.setInterval(() => {
      const left = (endAtRef.current ?? 0) - Date.now();
      if (left > 0) {
        setRemaining(left);
        return;
      }
      const phaseDurMs = (phase === 'focus' ? preset.focus
                        : phase === 'short-break' ? preset.short
                        : preset.long) * 1000;
      const finished: CompletedSession = {
        id: crypto.randomUUID(),
        phase,
        durationSec: phaseDurMs / 1000,
        endedAt: Date.now(),
        preset: preset.id,
      };
      setHistory((h) => [finished, ...h].slice(0, 50));

      let nextCycles = cycles;
      if (phase === 'focus') {
        nextCycles = cycles + 1;
        setCycles(nextCycles);
      }
      const np: Phase = phase === 'focus'
        ? (nextCycles > 0 && nextCycles % preset.longEvery === 0 ? 'long-break' : 'short-break')
        : 'focus';
      setPhase(np);
      const ndMs = (np === 'focus' ? preset.focus
                  : np === 'short-break' ? preset.short
                  : preset.long) * 1000;
      setRemaining(ndMs);
      endAtRef.current = Date.now() + ndMs;

      void platform.notify({
        text: phase === 'focus' ? '집중 완료 — 휴식하세요' : '휴식 끝 — 다시 시작',
        detail: `${PHASE_LABEL[np]} ${fmt(ndMs)}`,
        tone: phase === 'focus' ? 'success' : 'info',
        timeout: 4000,
      });
    }, 50);
    return () => { if (tickRef.current !== null) window.clearInterval(tickRef.current); };
    // remaining is intentionally not in deps — including it would tear down
    // the interval on every tick. We re-anchor endAtRef on running/phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase, preset, cycles]);

  const skip = () => {
    // Land just past zero so the next tick rolls over into the next phase.
    setRemaining(0);
    endAtRef.current = Date.now();
    setRunning(true);
  };

  const reset = () => {
    setRunning(false);
    setPhase('focus');
    setRemaining(preset.focus * 1000);
    endAtRef.current = null;
  };

  // Space toggles run/pause when focus is *not* inside an input/textarea so it
  // doesn't interfere with form fields elsewhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      setRunning((r) => !r);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const resetAll = () => {
    if (confirm('완료 기록과 사이클을 모두 초기화할까요?')) {
      setRunning(false);
      setPhase('focus');
      setRemaining(preset.focus * 1000);
      endAtRef.current = null;
      setCycles(0);
      setHistory([]);
      void platform.notify({ text: '기록이 초기화됐어요', tone: 'warn' });
    }
  };

  /* Derived stats */
  const stats = useMemo(() => {
    const today = todayKey();
    const todayFocus = history.filter((s) => s.phase === 'focus' && new Date(s.endedAt).toISOString().slice(0, 10) === today);
    const todayMinutes = Math.round(todayFocus.reduce((acc, s) => acc + s.durationSec, 0) / 60);
    return {
      todayCount: todayFocus.length,
      todayMinutes,
      totalFocus: history.filter((s) => s.phase === 'focus').length,
    };
  }, [history]);

  const phaseDurMs = (phase === 'focus' ? preset.focus
                    : phase === 'short-break' ? preset.short
                    : preset.long) * 1000;
  const progress = 1 - remaining / phaseDurMs;

  const accent =
    phase === 'focus' ? 'var(--accent, #2553f2)'
    : phase === 'short-break' ? 'var(--success, #38a169)'
    : 'var(--warn, #d6a800)';

  return (
    <section
      style={{
        background: 'var(--bg-panel, #fff)',
        border: '1px solid var(--border, #e2e2ea)',
        borderRadius: 14,
        color: 'var(--text, #1a1a1a)',
        fontFamily: 'var(--font-sans, -apple-system, system-ui, sans-serif)',
        overflow: 'hidden',
      }}
    >
      {/* Header — preset switcher wraps to its own row on narrow screens
          so the timer label doesn't get pushed off-screen. */}
      <header
        style={{
          padding: narrow ? '12px 14px' : '14px 18px',
          borderBottom: '1px solid var(--border, #ececf2)',
          display: 'flex',
          alignItems: narrow ? 'stretch' : 'center',
          flexDirection: narrow ? 'column' : 'row',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>🍅</span>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em' }}>
            Pomodoro
          </h3>
          {hosted && !narrow && <SdkBadge />}
        </div>
        <PresetSwitcher value={presetId} onChange={setPresetId} disabled={running} fullWidth={narrow} />
      </header>

      {/* Stats strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1,
          background: 'var(--border, #ececf2)',
          borderBottom: '1px solid var(--border, #ececf2)',
        }}
      >
        <Stat label="오늘 집중" value={stats.todayCount} unit="회" />
        <Stat label="오늘 누적" value={stats.todayMinutes} unit="분" />
        <Stat label="전체 집중" value={stats.totalFocus} unit="회" />
      </div>

      {/* Timer body */}
      <div
        style={{
          padding: narrow ? '20px 14px 8px' : '28px 18px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: 'var(--text-muted, #999)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            marginBottom: 8,
          }}
        >
          {PHASE_EYEBROW[phase]} · 사이클 <span className="tabular" style={{ color: 'var(--text-mid)' }}>{cycles}</span>
        </div>

        <Ring progress={progress} color={accent} size={narrow ? 180 : 220}>
          <div
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
              fontSize: narrow ? 32 : 44,
              fontWeight: 600,
              color: 'var(--text)',
              letterSpacing: '-0.03em',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'baseline',
              gap: 1,
            }}
            className="tabular"
          >
            {(() => {
              const [main, frac] = fmt(remaining).split('.');
              return (
                <>
                  <span>{main}</span>
                  <span style={{ fontSize: '0.5em', color: 'var(--text-muted)', fontWeight: 500 }}>
                    .{frac}
                  </span>
                </>
              );
            })()}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted, #888)', marginTop: 8 }}>
            {PHASE_LABEL[phase]}
          </div>
        </Ring>

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: narrow ? 18 : 24,
            width: narrow ? '100%' : 'auto',
          }}
        >
          <button
            onClick={() => setRunning((r) => !r)}
            style={{ ...primaryBtn(false), flex: narrow ? 1 : 'initial' }}
            title="Space로도 토글할 수 있어요"
          >
            {running ? '일시정지' : '시작'}
          </button>
          <button onClick={skip} style={{ ...secondaryBtn, flex: narrow ? 1 : 'initial' }} title="현재 단계 건너뛰기">
            건너뛰기
          </button>
          <button onClick={reset} style={{ ...secondaryBtn, flex: narrow ? 1 : 'initial' }}>
            리셋
          </button>
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 10.5,
            color: 'var(--text-dim, #999)',
            display: narrow ? 'none' : 'block',
          }}
        >
          <kbd>Space</kbd> 시작·일시정지
        </div>
      </div>

      {/* History */}
      <div style={{ padding: '14px 18px' }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: 'var(--text-muted, #999)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: '0 4px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>최근 완료</span>
          {history.length > 0 && (
            <button
              type="button"
              onClick={resetAll}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 10.5,
                cursor: 'pointer',
                padding: 0,
                letterSpacing: '0.04em',
              }}
            >
              모두 지우기
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div
            style={{
              padding: '20px 16px',
              background: 'var(--bg-elev, #fafafd)',
              border: '1px dashed var(--border-strong, #d4d4dc)',
              borderRadius: 10,
              fontSize: 12.5,
              color: 'var(--text-muted, #999)',
              textAlign: 'center',
            }}
          >
            첫 사이클을 완료하면 여기에 기록이 쌓여요.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {history.slice(0, 8).map((s) => (
              <HistoryRow key={s.id} session={s} />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <footer
        style={{
          padding: '10px 18px',
          borderTop: '1px solid var(--border, #ececf2)',
          background: 'var(--bg-rail, transparent)',
          fontSize: 11,
          color: 'var(--text-muted, #999)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          현재 preset: <code style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-mid)' }}>{preset.label}</code>
        </span>
        <span>{preset.longEvery}회 사이클마다 긴 휴식</span>
      </footer>
    </section>
  );
}

/* ─── Sub-components ─── */

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '0 18px',
    height: 38,
    background: 'var(--accent, #2553f2)',
    color: 'var(--accent-fg, #fff)',
    border: 'none',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    minWidth: 100,
    transition: 'background 100ms var(--ease)',
  };
}

const secondaryBtn: React.CSSProperties = {
  padding: '0 14px',
  height: 38,
  background: 'transparent',
  color: 'var(--text, #1a1a1a)',
  border: '1px solid var(--border-strong, #d4d4dc)',
  borderRadius: 8,
  fontWeight: 500,
  fontSize: 12.5,
  cursor: 'pointer',
};

function Ring({ progress, color, children, size = 220 }: { progress: number; color: string; children: React.ReactNode; size?: number }) {
  const inner = size - 32;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        background: `conic-gradient(${color} ${progress * 360}deg, var(--bg-elev) 0deg)`,
        transition: 'background 300ms linear',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          borderRadius: '50%',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--bg-panel)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span className="tabular" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          {value}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{unit}</span>
      </div>
    </div>
  );
}

function PresetSwitcher({
  value, onChange, disabled, fullWidth = false,
}: {
  value: string; onChange: (id: string) => void; disabled: boolean; fullWidth?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Preset"
      style={{
        display: 'flex',
        gap: 2,
        padding: 2,
        background: 'var(--bg-elev, #f7f7fa)',
        border: '1px solid var(--border, #e2e2ea)',
        borderRadius: 7,
        opacity: disabled ? 0.6 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        width: fullWidth ? '100%' : undefined,
      }}
    >
      {PRESETS.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            aria-pressed={active}
            style={{
              padding: '4px 8px',
              background: active ? 'var(--bg-panel, #fff)' : 'transparent',
              color: active ? 'var(--text, #1a1a1a)' : 'var(--text-muted, #888)',
              border: 'none',
              borderRadius: 5,
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              flex: 1,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function HistoryRow({ session }: { session: CompletedSession }) {
  const toneColor =
    session.phase === 'focus'        ? 'var(--accent)'
    : session.phase === 'short-break'? 'var(--success)'
    :                                  'var(--warn)';
  return (
    <li
      style={{
        padding: '8px 10px',
        background: 'var(--bg-elev, #fff)',
        border: '1px solid var(--border, #ececf2)',
        borderLeft: `3px solid ${toneColor}`,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--text-mid)' }}>{PHASE_LABEL[session.phase]}</span>
      <span className="tabular" style={{ color: 'var(--text-muted)' }}>
        {Math.round(session.durationSec / 60)}분
      </span>
      <span style={{ flex: 1 }} />
      <time
        className="tabular"
        dateTime={new Date(session.endedAt).toISOString()}
        style={{ fontSize: 11, color: 'var(--text-dim)' }}
      >
        {new Date(session.endedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
      </time>
    </li>
  );
}

function SdkBadge() {
  return (
    <span
      style={{
        fontSize: 10.5,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--success-soft, rgba(0,180,80,0.12))',
        color: 'var(--success, #0a8a52)',
        fontWeight: 600,
        letterSpacing: '0.04em',
      }}
      title="플랫폼 SDK 연결됨"
    >
      SDK CONNECTED
    </span>
  );
}
