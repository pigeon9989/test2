import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, Pill, ProgressRing, Segmented, Stack, StatCard, Text,
} from '@mf-platform/ui';
import { platform } from '../platform';

/* ─── Constants ─── */

interface Preset {
  id: 'classic' | 'long' | 'sprint' | 'deep';
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

const PHASE_TONE: Record<Phase, 'accent' | 'success' | 'warn'> = {
  'focus':       'accent',
  'short-break': 'success',
  'long-break':  'warn',
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
  presetId: Preset['id'];
  cycles: number;
  history: CompletedSession[];
}

// Module-local narrow-viewport hook — modules deploy independently of
// the host so we don't depend on host hooks.
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

/* ─── Component ─── */

export default function App() {
  const [presetId, setPresetId] = useState<Preset['id']>('classic');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;

  const [phase, setPhase] = useState<Phase>('focus');
  const [remaining, setRemaining] = useState<number>(preset.focus * 1000);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const [history, setHistory] = useState<CompletedSession[]>([]);
  const [hosted, setHosted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const tickRef = useRef<number | null>(null);
  // Wall-clock anchor so the timer doesn't drift on slow frames or background-throttled
  // tabs — we always recompute remaining from (endAt - now).
  const endAtRef = useRef<number | null>(null);
  const narrow = useIsNarrow();

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

  useEffect(() => {
    if (!hydrated) return;
    void platform.storage.set(STORAGE_KEY, { presetId, cycles, history } satisfies PersistedState);
  }, [presetId, cycles, history, hydrated]);

  useEffect(() => {
    if (!running) {
      setPhase('focus');
      setRemaining(preset.focus * 1000);
      endAtRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

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
    // remaining intentionally absent — including it would tear down the interval each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase, preset, cycles]);

  const skip = () => {
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

  // Space toggles run/pause when focus isn't inside an input/textarea.
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
  const ringSize = narrow ? 180 : 220;
  const innerWidth = ringSize - 32;
  const [main, frac] = fmt(remaining).split('.');

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        color: 'var(--text)',
        fontFamily: 'var(--font-sans, -apple-system, system-ui, sans-serif)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: narrow ? '12px 14px' : '14px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: narrow ? 'stretch' : 'center',
          flexDirection: narrow ? 'column' : 'row',
          gap: 10,
        }}
      >
        <Stack align="center" gap="sm" style={{ flex: 1, minWidth: 0 }}>
          <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>🍅</span>
          <Text weight="semibold" size="md">Pomodoro</Text>
          {hosted && !narrow && (
            <Pill tone="success" size="sm" style={{ letterSpacing: '0.04em' }}>SDK CONNECTED</Pill>
          )}
        </Stack>
        <Segmented<Preset['id']>
          value={presetId}
          onChange={setPresetId}
          options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          size="sm"
          disabled={running}
          fullWidth={narrow}
          aria-label="Preset"
        />
      </header>

      {/* Stats strip — three StatCards in a grid, no inline custom styling. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1,
          background: 'var(--border)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <StatCard label="오늘 집중" value={<>{stats.todayCount}<UnitLabel unit="회" /></>} />
        <StatCard label="오늘 누적" value={<>{stats.todayMinutes}<UnitLabel unit="분" /></>} />
        <StatCard label="전체 집중" value={<>{stats.totalFocus}<UnitLabel unit="회" /></>} />
      </div>

      {/* Timer */}
      <div style={{ padding: narrow ? '20px 14px 8px' : '28px 18px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Text size="xs" weight="semibold" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
          {PHASE_EYEBROW[phase]} · 사이클 <span className="tabular" style={{ color: 'var(--text-mid)' }}>{cycles}</span>
        </Text>

        <ProgressRing value={progress} size={ringSize} thickness={16} tone={PHASE_TONE[phase]}>
          {/* The ProgressRing wrapper uses `display: inline-grid; place-items: center`
              so the child sits perfectly centered without needing position:absolute. */}
          <div
            style={{
              width: innerWidth,
              height: innerWidth,
              borderRadius: '50%',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
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
              <span>{main}</span>
              <span style={{ fontSize: '0.5em', color: 'var(--text-muted)', fontWeight: 500 }}>.{frac}</span>
            </div>
            <Text size="xs" tone="muted" style={{ marginTop: 8 }}>{PHASE_LABEL[phase]}</Text>
          </div>
        </ProgressRing>

        <Stack gap="sm" wrap justify="center" style={{ marginTop: narrow ? 18 : 24, width: narrow ? '100%' : 'auto' }}>
          <Button
            variant="primary"
            size="lg"
            onClick={() => setRunning((r) => !r)}
            title="Space로도 토글할 수 있어요"
            style={narrow ? { flex: 1 } : { minWidth: 100 }}
          >
            {running ? '일시정지' : '시작'}
          </Button>
          <Button size="lg" onClick={skip} title="현재 단계 건너뛰기" style={narrow ? { flex: 1 } : undefined}>
            건너뛰기
          </Button>
          <Button size="lg" onClick={reset} style={narrow ? { flex: 1 } : undefined}>
            리셋
          </Button>
        </Stack>
        {!narrow && (
          <Text size="xs" tone="dim" style={{ marginTop: 10 }}>
            <kbd>Space</kbd> 시작·일시정지
          </Text>
        )}
      </div>

      {/* History */}
      <div style={{ padding: '14px 18px' }}>
        <Stack align="center" justify="between" style={{ margin: '0 4px 8px' }}>
          <Text size="xs" weight="semibold" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            최근 완료
          </Text>
          {history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={resetAll} style={{ letterSpacing: '0.04em' }}>
              모두 지우기
            </Button>
          )}
        </Stack>
        {history.length === 0 ? (
          <div
            style={{
              padding: '20px 16px',
              background: 'var(--bg-elev)',
              border: '1px dashed var(--border-strong)',
              borderRadius: 10,
              textAlign: 'center',
            }}
          >
            <Text tone="muted" size="sm">첫 사이클을 완료하면 여기에 기록이 쌓여요.</Text>
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
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-rail, transparent)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Text size="xs" tone="muted">
          현재 preset: <code style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-mid)' }}>{preset.label}</code>
        </Text>
        <Text size="xs" tone="muted">{preset.longEvery}회 사이클마다 긴 휴식</Text>
      </footer>
    </section>
  );
}

/* ─── Sub-components ─── */

function UnitLabel({ unit }: { unit: string }) {
  return <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 500, marginLeft: 4 }}>{unit}</span>;
}

function HistoryRow({ session }: { session: CompletedSession }) {
  const toneColor =
    session.phase === 'focus'        ? 'var(--accent)'
    : session.phase === 'short-break'? 'var(--success)'
    :                                  'var(--warn)';
  return (
    <li>
      <Card
        padding={0}
        style={{
          background: 'var(--bg-elev)',
          borderLeft: `3px solid ${toneColor}`,
          padding: '8px 10px',
        }}
      >
        <Stack align="center" gap="sm">
          <Text size="sm" tone="default" style={{ color: 'var(--text-mid)' }}>{PHASE_LABEL[session.phase]}</Text>
          <Text size="xs" tone="muted" mono>{Math.round(session.durationSec / 60)}분</Text>
          <span style={{ flex: 1 }} />
          <time
            className="tabular"
            dateTime={new Date(session.endedAt).toISOString()}
            style={{ fontSize: 11, color: 'var(--text-dim)' }}
          >
            {new Date(session.endedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
          </time>
        </Stack>
      </Card>
    </li>
  );
}
