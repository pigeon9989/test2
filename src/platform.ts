// Lightweight MF Platform SDK shim. Imported by this remote to talk to the
// host (toast notifications, command palette, scoped storage, etc.).
//
// Two transports:
//   • Module Federation — host attaches an in-process bridge to
//     `window.__mf_platform_host__`; we prefer that when present.
//   • iframe / standalone — falls back to noop (or postMessage to parent).
//
// This file is intentionally self-contained so the remote stays publishable
// to GitHub Pages without an npm dependency on the in-monorepo
// `@mf-platform/sdk` package.

const MODULE = 'test2-pomodoro';
const NS = 'mf-platform-sdk';

type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

interface Toast { text: string; detail?: string; tone?: Tone; timeout?: number; }

interface HostBridge {
  call(module: string, method: string, args: unknown[]): Promise<unknown>;
  subscribe(channel: string, fn: (data: unknown, from?: string) => void): () => void;
}

declare global {
  interface Window {
    __mf_platform_host__?: HostBridge;
  }
}

function host(): HostBridge | null {
  if (typeof window === 'undefined') return null;
  return window.__mf_platform_host__ ?? null;
}

let nextId = 0;
const pending = new Map<string, (res: { result?: unknown; error?: { message: string } }) => void>();
let listenerAttached = false;

// Host origin discovery. Refusing to default to "*" — sending to wildcard
// from inside an iframe leaks every call's args (incl. tokens) to whatever
// page ends up hosting us. Resolution order:
//   1. ?__mfHost=<origin>           — explicit; host adds this when it builds
//                                     the iframe src
//   2. location.ancestorOrigins[0]  — Chromium-only but reliable
//   3. document.referrer's origin   — present unless Referrer-Policy stripped
// If none of those produce an origin we refuse to send (returns null).
let cachedHostOrigin: string | null | undefined;
function detectHostOrigin(): string | null {
  if (cachedHostOrigin !== undefined) return cachedHostOrigin;
  if (typeof window === 'undefined') return (cachedHostOrigin = null);
  const fromQuery = new URLSearchParams(window.location.search).get('__mfHost');
  if (fromQuery) return (cachedHostOrigin = fromQuery);
  const anc = (window.location as unknown as { ancestorOrigins?: { length: number; [0]: string } }).ancestorOrigins;
  if (anc && anc.length > 0) return (cachedHostOrigin = anc[0]);
  if (document.referrer) {
    try { return (cachedHostOrigin = new URL(document.referrer).origin); } catch { /* fall through */ }
  }
  return (cachedHostOrigin = null);
}

function ensureListener() {
  if (listenerAttached || typeof window === 'undefined') return;
  listenerAttached = true;
  window.addEventListener('message', (ev) => {
    // Verify the sender is who we think the host is. Drop any message
    // whose origin doesn't match our resolved host (or, if we couldn't
    // resolve one yet, snapshot the first matching ns message's origin).
    const expected = detectHostOrigin();
    if (expected && ev.origin !== expected) return;
    const d = ev.data as { ns?: string; kind?: string; id?: string; result?: unknown; error?: { message: string } };
    if (!d || d.ns !== NS) return;
    if (!expected) cachedHostOrigin = ev.origin; // adopt from first valid message
    if (d.kind === 'result' && d.id) {
      const fn = pending.get(d.id);
      if (fn) { pending.delete(d.id); fn({ result: d.result, error: d.error }); }
    }
  });
}

async function callIframe(method: string, args: unknown[] = []): Promise<unknown> {
  if (typeof window === 'undefined') throw new Error('no window');
  ensureListener();
  const target = detectHostOrigin();
  if (!target) throw new Error('mf-platform: host origin not resolvable — pass ?__mfHost=<origin> in the iframe URL');
  const id = `${MODULE}-${++nextId}`;
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, ({ result, error }) => {
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
    window.parent.postMessage({ ns: NS, kind: 'call', id, module: MODULE, method, args }, target);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 3000);
  });
}

async function call(method: string, args: unknown[] = []): Promise<unknown> {
  const h = host();
  if (h) return h.call(MODULE, method, args);
  // iframe mode (only if there is a parent frame)
  if (typeof window !== 'undefined' && window.parent !== window) return callIframe(method, args);
  return undefined;
}

export const platform = {
  /** True when running inside the MF Platform host. */
  get connected(): boolean {
    return !!host() || (typeof window !== 'undefined' && window.parent !== window);
  },

  /** Show a toast in the host. Silent no-op when standalone. */
  async notify(toast: Toast): Promise<void> {
    try { await call('notify', [toast]); } catch { /* ignore */ }
  },

  /** Per-module storage backed by host. Falls back to localStorage. */
  storage: {
    async get<T = unknown>(key: string): Promise<T | null> {
      try {
        const v = await call('storage.get', [key]);
        if (v != null) return v as T;
      } catch { /* ignore */ }
      try {
        const raw = localStorage.getItem(`mf:fallback:${MODULE}:${key}`);
        return raw == null ? null : JSON.parse(raw) as T;
      } catch { return null; }
    },
    async set(key: string, value: unknown): Promise<void> {
      try { await call('storage.set', [key, value]); return; } catch { /* fall through */ }
      try { localStorage.setItem(`mf:fallback:${MODULE}:${key}`, JSON.stringify(value)); } catch { /* ignore */ }
    },
  },

  async registerCommand(cmd: { id: string; label: string; hint?: string }, invoke: () => void): Promise<() => void> {
    try {
      await call('command.register', [cmd]);
      const h = host();
      if (h) {
        return h.subscribe(`command.invoke:${MODULE}:${cmd.id}`, () => invoke());
      }
      // iframe path: listen on window.message for the dispatched event
      const handler = (ev: MessageEvent) => {
        const d = ev.data as { ns?: string; kind?: string; channel?: string };
        if (d?.ns === NS && d?.kind === 'event' && d.channel === `command.invoke:${MODULE}:${cmd.id}`) invoke();
      };
      window.addEventListener('message', handler);
      return () => {
        window.removeEventListener('message', handler);
        void call('command.unregister', [cmd.id]).catch(() => undefined);
      };
    } catch {
      return () => undefined;
    }
  },
};
