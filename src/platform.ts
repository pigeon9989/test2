// Lightweight MF Platform SDK shim. See test1/src/platform.ts for the
// full annotated copy; kept inline here so the remote stays publishable
// to GitHub Pages without an npm dependency.

const MODULE = 'test2-pomodoro';
const NS = 'mf-platform-sdk';

type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';
interface Toast { text: string; detail?: string; tone?: Tone; timeout?: number; }
interface HostBridge {
  call(module: string, method: string, args: unknown[]): Promise<unknown>;
  subscribe(channel: string, fn: (data: unknown, from?: string) => void): () => void;
}

declare global { interface Window { __mf_platform_host__?: HostBridge; } }

function host(): HostBridge | null {
  if (typeof window === 'undefined') return null;
  return window.__mf_platform_host__ ?? null;
}

let nextId = 0;
const pending = new Map<string, (r: { result?: unknown; error?: { message: string } }) => void>();
let attached = false;
function ensure() {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('message', (ev) => {
    const d = ev.data as { ns?: string; kind?: string; id?: string; result?: unknown; error?: { message: string } };
    if (!d || d.ns !== NS || d.kind !== 'result' || !d.id) return;
    const fn = pending.get(d.id);
    if (fn) { pending.delete(d.id); fn({ result: d.result, error: d.error }); }
  });
}

async function call(method: string, args: unknown[] = []): Promise<unknown> {
  const h = host();
  if (h) return h.call(MODULE, method, args);
  if (typeof window === 'undefined' || window.parent === window) return undefined;
  ensure();
  const id = `${MODULE}-${++nextId}`;
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, ({ result, error }) => error ? reject(new Error(error.message)) : resolve(result));
    window.parent.postMessage({ ns: NS, kind: 'call', id, module: MODULE, method, args }, '*');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 3000);
  });
}

export const platform = {
  get connected(): boolean {
    return !!host() || (typeof window !== 'undefined' && window.parent !== window);
  },
  async notify(t: Toast): Promise<void> { try { await call('notify', [t]); } catch { /* ignore */ } },
  storage: {
    async get<T = unknown>(key: string): Promise<T | null> {
      try {
        const v = await call('storage.get', [key]);
        if (v != null) return v as T;
      } catch { /* fall through */ }
      try {
        const raw = localStorage.getItem(`mf:fallback:${MODULE}:${key}`);
        return raw == null ? null : JSON.parse(raw) as T;
      } catch { return null; }
    },
    async set(key: string, value: unknown): Promise<void> {
      try { await call('storage.set', [key, value]); return; }
      catch {
        try { localStorage.setItem(`mf:fallback:${MODULE}:${key}`, JSON.stringify(value)); } catch { /* ignore */ }
      }
    },
  },
};
