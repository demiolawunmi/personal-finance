import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type CSSProperties,
  type FormEvent,
} from 'react';

/* Quiet Ledger — React port of the Personal Finance redesign prototype.
   Visual system and structure mirror the exported design; data comes from the
   live dashboard API. */

type Money = { amount: string; currency: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/* ----------------------------------------------------------- helpers */
const moneyFmt: Record<string, Intl.NumberFormat> = {};
function fmtMoney(mv: Money | null | undefined): string {
  if (!mv) return '—';
  const cur = mv.currency || 'CAD';
  if (!moneyFmt[cur])
    moneyFmt[cur] = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return moneyFmt[cur].format(Number(mv.amount));
}
const num = (mv: Money | null | undefined): number => (mv ? Number(mv.amount) : 0);
function fmtCompact(v: number): string {
  const n = Math.abs(v);
  if (n >= 1000) return (v < 0 ? '-' : '') + '$' + (n / 1000).toFixed(1) + 'k';
  return (v < 0 ? '-' : '') + '$' + n.toFixed(0);
}
function fmtPct(v: number | null | undefined, d = 0): string {
  if (v == null || isNaN(v)) return '—';
  return (v * 100).toFixed(d) + '%';
}
function label(s: string | null | undefined): string {
  return String(s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  });
}
function fmtDateLong(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
  );
}
function relTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - Date.parse(iso);
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
}
type PeriodRange = { start: string; end: string; label: string };
function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}
function addDaysISO(date: string, days: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
function monthBounds(ym: string): { start: string; end: string } {
  const first = ym + '-01';
  const d = new Date(first + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { start: first, end: d.toISOString().slice(0, 10) };
}
function monthRange(ym: string): PeriodRange {
  return { ...monthBounds(ym), label: monthLabel(ym) };
}
function defaultRange(): PeriodRange {
  return monthRange(todayISO().slice(0, 7));
}
function startOfWeek(date: string): string {
  const day = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return addDaysISO(date, -day);
}
function describePeriod(start: string, end: string): string {
  const today = todayISO();
  if (start === end) return start === today ? 'Today' : fmtDateLong(start);
  const month = monthBounds(start.slice(0, 7));
  if (start === month.start && end === month.end) return monthLabel(start.slice(0, 7));
  if (start === startOfWeek(today) && end === addDaysISO(startOfWeek(today), 6)) return 'This week';
  return `${fmtDate(start)} – ${fmtDateLong(end)}`;
}
function periodText(period: { start: string; end: string } | undefined): string {
  if (!period) return '';
  return describePeriod(period.start, period.end);
}
function statusTone(status: string): string {
  if (['fresh', 'healthy', 'ready', 'active', 'on_track'].includes(status)) return 'pill-pos';
  if (['degraded', 'stale', 'needs_action', 'ahead_of_pace', 'reauth_required'].includes(status))
    return 'pill-warn';
  if (['error', 'over_budget', 'disconnected'].includes(status)) return 'pill-neg';
  return '';
}
function severityTone(severity: string | null | undefined): string {
  if (severity === 'high') return 'neg';
  if (severity === 'medium') return 'warn';
  if (severity === 'low') return 'info';
  return '';
}
function signalIcon(kind: string): string {
  if (kind === 'duplicate_candidate') return 'alert';
  if (kind === 'unusual_amount') return 'trend';
  if (kind === 'large_new_merchant') return 'bag';
  if (kind === 'fee') return 'receipt';
  if (kind === 'price_increase') return 'repeat';
  if (kind === 'category_pace') return 'trend';
  return 'bulb';
}
function openAnomalies(d: Any): Any[] {
  return (d?.anomalies ?? []).filter((a: Any) => (a.review_status ?? 'open') === 'open');
}
function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    from.current = target;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(origin + (target - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}
function categoryName(d: Any, id: string): string {
  const c = (d?.categoriesCatalog ?? []).find((x: Any) => x.id === id);
  if (c) return c.display_name;
  const special: Record<string, string> = {
    income: 'Income',
    transfer: 'Transfer',
    refund: 'Refund',
    unclassified_inflow: 'Unclassified inflow',
  };
  return special[id] || label(id);
}
const gap = (g: string): CSSProperties => ({ ['--od-gap' as any]: g }) as CSSProperties;

/* ------------------------------------------------------------ icons */
const PATHS: Record<string, string> = {
  overview: '<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
  insights:
    '<path d="M4 19V5"/><path d="M4 15l5-5 4 4 7-8"/><path d="M20 6h-4"/><path d="M20 6v4"/>',
  repeat:
    '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  target:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  cards: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 5.5"/><path d="M20 5v6h-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6"/>',
  fork: '<path d="M7 3v7a2 2 0 0 0 4 0V3"/><path d="M9 10v11"/><path d="M16 3c-1.5 1-2 2.5-2 4.5S14.8 11 16 11v10"/>',
  bag: '<path d="M6 8h12l1 12H5z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  car: '<path d="M5 16l1.5-5h11L19 16"/><path d="M4 16h16v3H4z"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/>',
  plane: '<path d="M10 21l2-6 8-8-1-1-8 2-6-6-2 2 4 6-3 3-2-1-1 1z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/>',
  heart:
    '<path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.5 12 20 12 20z"/>',
  rotate: '<path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 20v-5h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7"/><path d="M12 17h.01"/>',
  bank: '<path d="M3 10 12 4l9 6"/><path d="M5 10v9M19 10v9M9 19v-6M15 19v-6M3 21h18"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11z"/>',
  trend: '<path d="M4 17l5-5 4 3 7-8"/><path d="M20 7h-5"/><path d="M20 7v5"/>',
  wallet:
    '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1.3" fill="currentColor" stroke="none"/>',
};
function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      className={className || ''}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }}
    />
  );
}
const CAT_ICON: Record<string, string> = {
  groceries: 'cart',
  restaurants: 'fork',
  shopping: 'bag',
  home: 'overview',
  utilities: 'zap',
  transport: 'car',
  travel: 'plane',
  entertainment: 'play',
  health: 'heart',
  income: 'arrowDown',
  transfer: 'repeat',
  refund: 'rotate',
  unclassified_inflow: 'help',
};
const CAT_COLORS = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
  'var(--cat-6)',
];

/* ---------------------------------------------------------- charts */
function Sparkline({ values }: { values: number[] }) {
  if (!values || values.length < 2) return null;
  const w = 640,
    h = 140,
    pad = 8;
  const min = Math.min(...values),
    max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map(
    (v, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (v - min) / span)] as const,
  );
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area =
    line +
    ` L ${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L ${pts[0][0].toFixed(1)} ${h - pad} Z`;
  return (
    <svg
      className="chart spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Net worth trend"
    >
      <path d={area} style={{ fill: 'var(--positive)', fillOpacity: 0.1, stroke: 'none' }} />
      <path
        d={line}
        pathLength={1}
        style={{ fill: 'none', stroke: 'var(--positive)', strokeWidth: 2 }}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Donut({
  parts,
  size = 148,
  thickness = 16,
  label: ariaLabel,
}: {
  parts: { ratio: number; color: string }[];
  size?: number;
  thickness?: number;
  label?: string;
}) {
  const r = (size - thickness) / 2,
    cx = size / 2,
    cy = size / 2,
    c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg
      className="chart"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel || 'chart'}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        style={{ stroke: 'var(--surface-2)', strokeWidth: thickness }}
      />
      {parts.map((p, i) => {
        const len = c * Math.max(0, Math.min(1, p.ratio));
        const el = (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            style={{
              stroke: p.color,
              strokeWidth: thickness,
              strokeDasharray: `${len.toFixed(2)} ${(c - len).toFixed(2)}`,
              strokeDashoffset: (-off).toFixed(2),
            }}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        off += len;
        return el;
      })}
    </svg>
  );
}

/* --------------------------------------------------------- fragments */
function Stat({
  label: l,
  value,
  caption,
  cls,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  cls?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{l}</span>
      <span className={'stat-value ' + (cls || '')}>{value}</span>
      {caption && <span className="stat-caption">{caption}</span>}
    </div>
  );
}
function Card({
  title,
  extra,
  children,
}: {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card-head">
          <h2>{title}</h2>
          {extra}
        </div>
      ) : null}
      {children}
    </section>
  );
}
function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <Icon name="bulb" />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && (
        <button className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
type Insight = {
  tone?: string;
  icon?: string;
  title: string;
  text: string;
  meta?: ReactNode;
  action?: { label: string; onClick: () => void };
};
function InsightCard({ tone, icon, title, text, meta, action }: Insight) {
  return (
    <article className="insight">
      <span className={'insight-icon ' + (tone || '')}>
        <Icon name={icon || 'info'} />
      </span>
      <div className="od-stack" style={gap('2px')}>
        <span className="insight-title">{title}</span>
        <span className="insight-text">{text}</span>
        {action && (
          <span style={{ marginTop: 6 }}>
            <button className="btn btn-sm" onClick={action.onClick}>
              {action.label}
            </button>
          </span>
        )}
      </div>
      <div className="od-fixed" style={{ textAlign: 'right' }}>
        {meta}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------- API */
const friendlyError = (code: string) =>
  ({
    PLAID_NOT_CONFIGURED:
      'Plaid is not configured in the Worker environment. Add PLAID_CLIENT_ID and PLAID_SECRET, then restart the Worker.',
    INVALID_API_KEYS:
      'Plaid rejected the credentials. Confirm you copied the Sandbox client ID and Sandbox secret from the Plaid Dashboard.',
    INVALID_ENCRYPTION_KEY:
      'TOKEN_ENCRYPTION_KEY is invalid. Generate a fresh 32-byte base64 key with: openssl rand -base64 32',
    PRODUCT_NOT_READY: 'Plaid has not enabled the Transactions product for this application yet.',
    INSTITUTION_NOT_SUPPORTED:
      'This institution is not available in the configured Plaid environment.',
    PLAID_UNAVAILABLE: 'Plaid is temporarily unavailable. Try again in a moment.',
    DERIVED_DATA_REBUILDING:
      'Your latest data is still being recalculated. This clears in a moment — retrying.',
    DATABASE_UNINITIALIZED: 'The database is not initialized yet. Run the D1 migrations.',
  })[code] ?? code;
class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
async function api(path: string, csrf = '', body?: unknown, method = 'GET'): Promise<any> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const e = (await response.json().catch(() => ({}))) as { error?: string };
    const code = e.error ?? 'REQUEST_FAILED';
    throw new ApiError(
      code,
      response.status === 401
        ? 'Sign in to access your finances.'
        : code === 'SERVICE_UNAVAILABLE'
          ? 'Data is temporarily unavailable. A sync or rebuild may be running. Try again shortly.'
          : friendlyError(code),
    );
  }
  return response.json();
}
// Reads can fail briefly while a queued rebuild publishes derived tables.
async function apiRetry(path: string, attempts = 8): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      return await api(path);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DERIVED_DATA_REBUILDING' && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 700 + i * 500));
        continue;
      }
      throw e;
    }
  }
}

/* ------------------------------------------------------- nav + meta */
const NAV = [
  { view: 'overview', label: 'Overview', icon: 'overview' },
  { view: 'transactions', label: 'Transactions', icon: 'list' },
  { view: 'insights', label: 'Insights', icon: 'insights' },
  { view: 'recurring', label: 'Recurring', icon: 'repeat' },
  { view: 'budget', label: 'Budget', icon: 'target' },
  { view: 'reports', label: 'Reports', icon: 'file' },
  { view: 'accounts', label: 'Accounts', icon: 'cards' },
  { view: 'health', label: 'Data Health', icon: 'shield' },
  { view: 'settings', label: 'Settings', icon: 'settings' },
];
const META: Record<string, { title: string; sub: string }> = {
  overview: { title: 'Your money, at a glance.', sub: 'Overview' },
  transactions: { title: 'Transactions', sub: 'Every movement, one list' },
  insights: { title: 'Insights', sub: 'Spending and signals' },
  recurring: { title: 'Recurring', sub: 'Subscriptions and commitments' },
  budget: { title: 'Budget', sub: 'Category limits and pace' },
  reports: { title: 'Reports', sub: 'Saved calculations' },
  accounts: { title: 'Accounts', sub: 'Balances and connections' },
  health: { title: 'Data Health', sub: 'Coverage and reconciliation' },
  settings: { title: 'Settings', sub: 'Goals, rules and access' },
  setup: { title: 'Setup', sub: 'Private onboarding' },
};
const ENDPOINTS: Record<string, string> = {
  setup: 'setup',
  overview: 'overview',
  transactions: 'transactions',
  insights: 'spending',
  recurring: 'recurring',
  budget: 'budget',
  reports: 'reports',
  accounts: 'connections',
  health: 'data-health',
  settings: 'goals',
};
const VIEW_PATH: Record<string, string> = {
  setup: '/setup',
  overview: '/',
  transactions: '/transactions',
  insights: '/spending',
  recurring: '/recurring',
  budget: '/budget',
  reports: '/reports',
  accounts: '/connections',
  health: '/data-health',
  settings: '/settings',
};
const AGGREGATE = ['overview', 'insights', 'recurring', 'budget', 'reports'];

function viewFromPath(path: string): string {
  const found = Object.keys(VIEW_PATH).find((v) => VIEW_PATH[v] === path);
  return found || 'overview';
}

/* ================================================================ App */
export default function App() {
  const [session, setSession] = useState<Any>(undefined);
  const [view, setView] = useState<string>(() => viewFromPath(location.pathname));
  const [currency, setCurrency] = useState('CAD');
  const [range, setRange] = useState<PeriodRange>(defaultRange);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [data, setData] = useState<Any>(null);
  const [accounts, setAccounts] = useState<Any[]>([]);
  const [categories, setCategories] = useState<Any[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [selectedTx, setSelectedTx] = useState<Any>(null);
  const [command, setCommand] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState<Any>(null);
  const [selectedReport, setSelectedReport] = useState<Any>(null);
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark',
  );

  const start = range.start;
  const end = range.end;

  /* theme */
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem('od-theme');
      } catch {
        return null;
      }
    })();
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    setDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);
  const toggleTheme = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('od-theme', next);
    } catch {
      /* ignore */
    }
    setDark(next === 'dark');
  };

  /* session */
  useEffect(() => {
    api('/api/session')
      .then((s) => {
        setSession(s);
        if (s.setup_required && location.pathname === '/') {
          setView('setup');
          history.replaceState(null, '', '/setup');
        }
      })
      .catch(() => setSession(null));
  }, []);
  useEffect(() => {
    if (session)
      api('/api/categories')
        .then(setCategories)
        .catch((e) => setError(e.message));
  }, [session]);

  /* primary data per view */
  useEffect(() => {
    if (!session || view === 'setup') return;
    let active = true;
    setLoading(true);
    setError('');
    setSelectedReport(null);
    const params = new URLSearchParams({ currency, start_date: start, end_date: end });
    if (view === 'transactions') {
      params.set('query', search);
      params.set('limit', '10');
      if (cursor) params.set('cursor', cursor);
      if (filterCategory) params.set('category_id', filterCategory);
      if (filterAccount) params.set('account_id', filterAccount);
      if (filterStatus) params.set('status', filterStatus);
    }
    const needsBalances = view === 'transactions' || view === 'accounts';
    Promise.all([
      apiRetry('/api/' + ENDPOINTS[view] + '?' + params),
      needsBalances ? apiRetry('/api/balances?' + params) : Promise.resolve(null),
    ])
      .then(([primary, balances]) => {
        if (!active) return;
        setData(primary);
        if (balances) setAccounts(balances.accounts ?? []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    session,
    view,
    currency,
    search,
    cursor,
    version,
    filterCategory,
    filterAccount,
    filterStatus,
    start,
    end,
  ]);

  /* setup data */
  useEffect(() => {
    if (!session || view !== 'setup') return;
    let active = true;
    setLoading(true);
    setError('');
    api('/api/setup')
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [session, view, version]);

  /* browser back/forward */
  useEffect(() => {
    const back = () => {
      setView(viewFromPath(location.pathname));
      setSelectedTx(null);
      setCursor(null);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommand((c) => !c);
        setCommandQuery('');
        return;
      }
      if (e.key === 'Escape') {
        setCommand(false);
        setMore(false);
        setSelectedTx(null);
        setConfirm(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const navigate = (next: string, filter?: { status?: string; fullYear?: boolean }) => {
    setView(next);
    setSelectedTx(null);
    setCommand(false);
    setMore(false);
    setCursor(null);
    setFilterCategory('');
    setFilterAccount('');
    setFilterStatus(filter?.status ?? '');
    if (filter?.fullYear)
      setRange({
        start: addDaysISO(todayISO(), -364),
        end: todayISO(),
        label: 'Last 12 months',
      });
    setNotice('');
    history.pushState(null, '', VIEW_PATH[next] ?? '/');
  };

  const toast = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? '' : n)), 2400);
  };

  async function mutate(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      const result = await api(path, session.csrf_token, body, method);
      toast(result.queued ? 'Queued. Refresh after synchronization finishes.' : 'Saved.');
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function connect(id?: string) {
    setBusy(true);
    setError('');
    try {
      const result = await api(
        id ? `/api/plaid/items/${id}/update-link-token` : '/api/plaid/link-token',
        session.csrf_token,
        {},
        'POST',
      );
      if (!(window as Any).Plaid) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Could not load Plaid Link.'));
          document.head.appendChild(script);
        });
      }
      const handler = (window as Any).Plaid.create({
        token: result.link_token,
        onSuccess: async (public_token: string) => {
          await mutate(
            id ? `/api/plaid/items/${id}/sync` : '/api/plaid/exchange',
            id ? {} : { public_token },
          );
          handler.destroy();
        },
        onExit: () => {
          handler.destroy();
          setBusy(false);
        },
      });
      handler.open();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (session === undefined)
    return (
      <main className="login">
        <p role="status">Opening your finance workspace…</p>
      </main>
    );
  if (!session)
    return (
      <main className="login">
        <div className="brand">
          <span className="brandmark">pf</span>
          <span>
            <span className="brand-name">Personal Finance</span>
            <span className="brand-sub">Quiet Ledger</span>
          </span>
        </div>
        <div className="login-content">
          <p className="eyebrow">Your private financial record</p>
          <h1>
            A clearer picture
            <br />
            of your money.
          </h1>
          <p>See where it is, where it went, and what deserves your attention.</p>
          <a className="btn btn-primary" href="/login">
            Sign in with GitHub
          </a>
          <p className="quiet">
            Only the configured owner can sign in. Bank connections are read-only.
          </p>
        </div>
        <footer>One place for your accounts, spending, and financial history.</footer>
      </main>
    );

  const badge = (() => {
    const signals = data?.signals?.length ?? openAnomalies(data).length;
    return signals + (data?.attention?.length ?? 0);
  })();

  return (
    <div>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <div className="app">
        <aside className="sidebar">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('overview');
            }}
          >
            <span className="brandmark">pf</span>
            <span>
              <span className="brand-name">Personal Finance</span>
              <span className="brand-sub">Quiet Ledger</span>
            </span>
          </a>
          <nav className="nav" aria-label="Main navigation">
            {NAV.map((n) => (
              <button
                key={n.view}
                className="nav-link"
                aria-current={n.view === view ? 'page' : undefined}
                onClick={() => navigate(n.view)}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {n.view === 'insights' && badge ? (
                  <span className="nav-badge">{badge}</span>
                ) : (
                  <span />
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <span className="env-pill">
              <span className="dot" />
              Private workspace
            </span>
            <span className="quiet">
              {session.environment === 'demo'
                ? 'Demo · synthetic data'
                : session.environment === 'production'
                  ? 'Production'
                  : 'Sandbox banking · single owner'}
            </span>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="topbar-title">
              <h1>{(META[view] || META.overview).title}</h1>
              <span className="eyebrow">{(META[view] || META.overview).sub}</span>
            </div>
            <div className="topbar-actions">
              {['overview', 'transactions', 'insights', 'recurring', 'budget', 'reports'].includes(
                view,
              ) && (
                <div className="period-anchor">
                  <button
                    type="button"
                    className="chip period-trigger"
                    title="Change date range"
                    aria-haspopup="dialog"
                    aria-expanded={periodOpen}
                    onClick={() => setPeriodOpen((o) => !o)}
                  >
                    <Icon name="calendar" />
                    {range.label}
                  </button>
                  {periodOpen && (
                    <PeriodPicker
                      range={range}
                      close={() => setPeriodOpen(false)}
                      apply={(next) => {
                        setRange(next);
                        setCursor(null);
                        setPeriodOpen(false);
                      }}
                    />
                  )}
                </div>
              )}
              <div className="field">
                <label className="sr-only" htmlFor="currency">
                  Currency
                </label>
                <select
                  className="select"
                  id="currency"
                  style={{ minWidth: 96 }}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <button
                className="icon-btn"
                aria-label="Refresh data"
                onClick={() => {
                  setVersion((v) => v + 1);
                  toast('Data refreshed.');
                }}
              >
                <Icon name="refresh" />
              </button>
              <button
                className="icon-btn"
                aria-label="Search (Command K)"
                onClick={() => {
                  setCommand(true);
                  setCommandQuery('');
                }}
              >
                <Icon name="search" />
              </button>
              <button className="icon-btn" aria-label="Toggle dark theme" onClick={toggleTheme}>
                <Icon name={dark ? 'sun' : 'moon'} />
              </button>
            </div>
          </header>
          <main id="content" tabIndex={-1}>
            {session.environment === 'demo' && (
              <div className="banner banner-warn" style={{ marginBottom: 'var(--sp-5)' }}>
                <Icon name="info" />
                <div className="banner-body">
                  Demo workspace · Synthetic data. Changes are temporary; bank connections are
                  disabled.
                </div>
              </div>
            )}
            {error && (
              <div
                className="banner banner-neg"
                role="alert"
                style={{ marginBottom: 'var(--sp-5)' }}
              >
                <Icon name="alert" />
                <div className="banner-body">{error}</div>
              </div>
            )}
            {data && (
              <div style={{ marginBottom: 'var(--sp-5)' }}>
                <NoticeStack d={data} nav={navigate} />
              </div>
            )}
            {loading && (
              <p className="quiet" role="status" style={{ padding: 'var(--sp-5) 0' }}>
                Loading {view}…
              </p>
            )}
            <div key={view}>
              {!loading && session.setup_required && view === 'setup' && data && (
                <SetupPanel
                  data={data}
                  demo={session.environment === 'demo'}
                  busy={busy}
                  categories={categories}
                  refresh={() => setVersion((v) => v + 1)}
                  connect={() => connect()}
                />
              )}
              {!loading && view === 'overview' && data && (
                <OverviewView
                  d={data}
                  categories={categories}
                  nav={navigate}
                  onOpenTx={setSelectedTx}
                  noActivity={noActivity(view, data)}
                  goCad={() => setCurrency('CAD')}
                />
              )}
              {!loading && view === 'transactions' && data && (
                <TransactionsView
                  d={data}
                  categories={categories}
                  accounts={accounts}
                  query={query}
                  setQuery={setQuery}
                  search={search}
                  setSearch={(s) => {
                    setSearch(s);
                    setCursor(null);
                  }}
                  month={start.slice(0, 7)}
                  setMonth={(m) => {
                    setRange(m ? monthRange(m) : defaultRange());
                    setCursor(null);
                  }}
                  filterCategory={filterCategory}
                  setFilterCategory={(v) => {
                    setFilterCategory(v);
                    setCursor(null);
                  }}
                  filterAccount={filterAccount}
                  setFilterAccount={(v) => {
                    setFilterAccount(v);
                    setCursor(null);
                  }}
                  filterStatus={filterStatus}
                  setFilterStatus={(v) => {
                    setFilterStatus(v);
                    setCursor(null);
                  }}
                  cursor={cursor}
                  setCursor={setCursor}
                  onOpenTx={setSelectedTx}
                />
              )}
              {!loading && view === 'insights' && data && (
                <InsightsView
                  d={data}
                  nav={navigate}
                  onOpenTx={setSelectedTx}
                  onReviewed={async (id) => {
                    setData((d: Any) => ({
                      ...d,
                      anomalies: (d.anomalies ?? []).filter((a: Any) => a.id !== id),
                      signals: (d.signals ?? []).filter((s: Any) => s.id !== id),
                    }));
                    await mutate('/api/anomalies/' + id + '/review', { status: 'reviewed' });
                  }}
                />
              )}
              {!loading && view === 'recurring' && data && (
                <RecurringView
                  d={data}
                  noActivity={noActivity(view, data)}
                  goCad={() => setCurrency('CAD')}
                />
              )}
              {!loading && view === 'budget' && data && (
                <BudgetView
                  d={data}
                  categories={categories}
                  currency={currency}
                  start={monthBounds(end.slice(0, 7)).start}
                  busy={busy}
                  save={(body: Any) =>
                    mutate(
                      '/api/budgets/' + (data.saved?.[0]?.id ?? crypto.randomUUID()),
                      body,
                      'PUT',
                    )
                  }
                  noActivity={noActivity(view, data)}
                  goCad={() => setCurrency('CAD')}
                />
              )}
              {!loading && view === 'reports' && data && (
                <ReportsView
                  d={data}
                  start={start}
                  end={end}
                  currency={currency}
                  busy={busy}
                  selectedReport={selectedReport}
                  setSelectedReport={setSelectedReport}
                  generate={(type: string, s: string, e: string) =>
                    mutate('/api/reports', { type, start_date: s, end_date: e, currency })
                  }
                  noActivity={noActivity(view, data)}
                  goCad={() => setCurrency('CAD')}
                />
              )}
              {!loading && view === 'accounts' && data && (
                <AccountsView
                  d={data}
                  accounts={accounts}
                  demo={session.environment === 'demo'}
                  busy={busy}
                  connect={connect}
                  mutate={mutate}
                  confirm={setConfirm}
                />
              )}
              {!loading && view === 'health' && data && <HealthView d={data} nav={navigate} />}
              {!loading && view === 'settings' && data && (
                <SettingsView
                  d={data}
                  categories={categories}
                  currency={currency}
                  busy={busy}
                  version={version}
                  mutate={mutate}
                  dark={dark}
                  toggleTheme={toggleTheme}
                  setupRequired={session.setup_required}
                  mcpOrigin={
                    session.environment === 'demo' ? 'http://localhost:8787' : location.origin
                  }
                  demo={session.environment === 'demo'}
                  logout={() => mutate('/api/logout', {}).then((ok) => ok && setSession(null))}
                />
              )}
            </div>
          </main>
        </div>
        <nav className="bottomnav" aria-label="Primary">
          {NAV.filter((n) =>
            ['overview', 'transactions', 'insights', 'budget'].includes(n.view),
          ).map((n) => (
            <button
              key={n.view}
              aria-current={n.view === view ? 'page' : undefined}
              onClick={() => navigate(n.view)}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </button>
          ))}
          <button
            aria-current={
              ['recurring', 'reports', 'accounts', 'health', 'settings'].includes(view)
                ? 'page'
                : undefined
            }
            onClick={() => setMore(true)}
          >
            <Icon name="more" />
            <span>More</span>
          </button>
        </nav>
      </div>

      {command && (
        <CommandOverlay
          d={data}
          query={commandQuery}
          setQuery={setCommandQuery}
          nav={navigate}
          onOpenTx={(tx) => {
            setSelectedTx(tx);
            setCommand(false);
          }}
          close={() => setCommand(false)}
        />
      )}
      {more && <MoreSheet view={view} nav={navigate} close={() => setMore(false)} />}
      {selectedTx && (
        <TxDrawer
          tx={selectedTx}
          categories={categories}
          onClose={() => setSelectedTx(null)}
          save={(id, body) => mutate('/api/transactions/' + id + '/annotation', body, 'PATCH')}
          busy={busy}
        />
      )}
      {confirm && (
        <ConfirmModal
          confirm={confirm}
          busy={busy}
          close={() => setConfirm(null)}
          run={async () => {
            const c = confirm;
            await mutate(c.path, c.body ?? {}, c.method ?? 'POST');
            setConfirm(null);
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}

function noActivity(view: string, d: Any): boolean {
  if (!d || !AGGREGATE.includes(view)) return false;
  if (view === 'overview' || view === 'insights')
    return !d.balances?.accounts?.length && !(d.categories ?? []).length && num(d.income) === 0;
  if (view === 'recurring')
    return !(d.series ?? []).length && !(d.possible ?? []).length && num(d.monthly_total) === 0;
  if (view === 'budget') return !(d.categories ?? []).length;
  return false;
}

/* ------------------------------------------------------- overlays */
function CommandOverlay({
  d,
  query,
  setQuery,
  nav,
  onOpenTx,
  close,
}: {
  d: Any;
  query: string;
  setQuery: (s: string) => void;
  nav: (v: string) => void;
  onOpenTx: (tx: Any) => void;
  close: () => void;
}) {
  const items = NAV.map((n) => ({
    kind: 'Go to',
    label: n.label,
    icon: n.icon,
    onClick: () => nav(n.view),
  })).concat(
    (d?.transactions ?? []).map((t: Any) => ({
      kind: 'Transaction',
      label: `${t.merchant} · ${fmtMoney(t.amount)} · ${fmtDate(t.date)}`,
      icon: CAT_ICON[t.category_id] || 'receipt',
      onClick: () => onOpenTx(t),
    })),
  );
  const q = query.toLowerCase();
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items.slice(0, 8);
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-box">
          <Icon name="search" />
          <input
            autoFocus
            type="text"
            placeholder="Search transactions or jump to a page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search transactions or pages"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="modal-list">
          {filtered.length ? (
            filtered.slice(0, 12).map((i, idx) => (
              <button className="modal-item" key={idx} onClick={i.onClick}>
                <Icon name={i.icon} />
                <span className="od-fill od-truncate">{i.label}</span>
                <span className="quiet" style={{ fontSize: 'var(--fs-xs)' }}>
                  {i.kind}
                </span>
              </button>
            ))
          ) : (
            <div style={{ padding: 'var(--sp-5)' }} className="quiet">
              No matches.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
function MoreSheet({
  view,
  nav,
  close,
}: {
  view: string;
  nav: (v: string) => void;
  close: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="All sections">
        <div className="drawer-head">
          <h2>All sections</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-list">
          {NAV.map((n) => (
            <button
              className="modal-item"
              key={n.view}
              aria-current={n.view === view ? 'page' : undefined}
              onClick={() => nav(n.view)}
            >
              <Icon name={n.icon} />
              <span className="od-fill">{n.label}</span>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
function TxDrawer({
  tx,
  categories,
  onClose,
  save,
  busy,
}: {
  tx: Any;
  categories: Any[];
  onClose: () => void;
  save: (id: string, body: Any) => Promise<boolean>;
  busy: boolean;
}) {
  const t = tx;
  const [annotation, setAnnotation] = useState<Any>({});
  useEffect(() => {
    api('/api/transactions/' + t.id + '/annotation')
      .then(setAnnotation)
      .catch(() => setAnnotation({}));
  }, [t.id]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="tx-title">
        <div className="drawer-head">
          <div className="od-stack" style={gap('2px')}>
            <span className="eyebrow">{fmtDateLong(t.date)}</span>
            <h2 id="tx-title">{t.merchant}</h2>
            <span className="quiet">{t.account_name || t.account_id}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-body">
          <div className="row" style={{ paddingTop: 0 }}>
            <div className="od-fill">
              <span className="row-sub">Amount</span>
              <span className="stat-value" style={{ fontSize: 'var(--fs-3xl)' }}>
                {fmtMoney(t.amount)}
              </span>
            </div>
            <span className={'pill ' + (t.pending ? 'pill-warn' : 'pill-pos')}>
              {t.pending ? 'Pending' : label(t.kind)}
            </span>
          </div>
          <div className="card card-flat" style={{ padding: 'var(--sp-4)' }}>
            <div className="row">
              <span className="od-fill quiet">Raw description</span>
              <span>{t.name}</span>
            </div>
            <div className="row">
              <span className="od-fill quiet">Classification</span>
              <span>{label(t.classification_source)}</span>
            </div>
            <div className="row">
              <span className="od-fill quiet">Currency</span>
              <span>{t.amount?.currency}</span>
            </div>
          </div>
          <form
            className="od-stack"
            style={gap('var(--sp-4)')}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const ok = await save(t.id, {
                merchant_override: String(f.get('merchant')) || null,
                category_override_id: String(f.get('category')) || null,
                exclude_from_spending: f.get('exclude') === 'on',
                note: String(f.get('note')) || null,
                rename_merchant: f.get('rename') === 'on',
              });
              if (ok) onClose();
            }}
          >
            <div className="field">
              <label htmlFor="a-merchant">Merchant override</label>
              <input
                className="input"
                id="a-merchant"
                name="merchant"
                maxLength={150}
                defaultValue={annotation?.merchant_override ?? ''}
                placeholder={t.merchant}
              />
              <label className="checkbox" style={{ marginTop: 'var(--sp-2)' }}>
                <input type="checkbox" name="rename" /> Apply this name to all "{t.merchant}"
                charges, past and future
              </label>
            </div>
            <div className="field">
              <label htmlFor="a-category">Category</label>
              <select
                className="select"
                id="a-category"
                name="category"
                defaultValue={annotation?.category_override_id ?? ''}
              >
                <option value="">Use automatic classification</option>
                {categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                name="exclude"
                defaultChecked={Boolean(annotation?.exclude_from_spending) || Boolean(t.excluded)}
              />{' '}
              Exclude from spending
            </label>
            <div className="field">
              <label htmlFor="a-note">Note</label>
              <textarea
                className="textarea"
                id="a-note"
                name="note"
                maxLength={2000}
                defaultValue={annotation?.note ?? ''}
                placeholder="Why this matters…"
              />
            </div>
            <div className="od-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                Save changes
              </button>
            </div>
          </form>
        </div>
      </aside>
    </>
  );
}
function ConfirmModal({
  confirm,
  busy,
  close,
  run,
}: {
  confirm: Any;
  busy: boolean;
  close: () => void;
  run: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={close} />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cf-title"
        style={{ maxWidth: 440 }}
      >
        <div className="drawer-head">
          <h2 id="cf-title">{confirm.title}</h2>
        </div>
        <div style={{ padding: 'var(--sp-5)' }}>
          <p className="quiet">{confirm.body}</p>
        </div>
        <div className="drawer-foot">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className={'btn ' + (confirm.danger ? 'btn-danger' : 'btn-primary')}
            onClick={run}
            disabled={busy}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------- views */
const NOTICE_TONE: Record<string, string> = {
  error: 'banner-neg',
  warning: 'banner-warn',
  success: 'banner-pos',
  info: 'banner-info',
};
const NOTICE_ICON: Record<string, string> = {
  error: 'alert',
  warning: 'alert',
  success: 'check',
  info: 'info',
};
function NoticeStack({
  d,
  nav,
}: {
  d: Any;
  nav: (v: string, filter?: { status?: string; fullYear?: boolean }) => void;
}) {
  const notices: Any[] = d?.data_freshness?.notices ?? d?.notices ?? [];
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('od-notices-dismissed') || '[]');
    } catch {
      return [];
    }
  });
  const visible = notices.filter((n) => !dismissed.includes(n.id));
  if (!visible.length) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem('od-notices-dismissed', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="od-stack" style={gap('var(--sp-3)')}>
      {visible.map((n) => (
        <div
          className={'banner ' + (NOTICE_TONE[n.severity] || 'banner-info')}
          key={n.id}
          role={n.severity === 'error' ? 'alert' : 'status'}
        >
          <Icon name={NOTICE_ICON[n.severity] || 'info'} />
          <div className="banner-body od-fill">
            <strong>{n.title}</strong>
            {n.body ? ' ' + n.body : ''}
            {n.action_label && n.view && (
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'var(--sp-2)' }}
                onClick={() =>
                  nav(
                    n.view,
                    n.id === 'unknown-inflows'
                      ? { status: 'unclassified', fullYear: true }
                      : undefined,
                  )
                }
              >
                {n.action_label}
              </button>
            )}
          </div>
          <button className="icon-btn" aria-label="Dismiss notice" onClick={() => dismiss(n.id)}>
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
function PeriodPicker({
  range,
  apply,
  close,
}: {
  range: PeriodRange;
  apply: (r: PeriodRange) => void;
  close: () => void;
}) {
  const today = todayISO();
  const thisMonth = monthBounds(today.slice(0, 7));
  const lastMonth = addDaysISO(thisMonth.start, -1).slice(0, 7);
  const weekStart = startOfWeek(today);
  const [selection, setSelection] = useState<{
    start: string;
    end: string;
    picking: boolean;
  }>({ start: range.start, end: range.end, picking: false });
  const draft = selection;
  const pickingEnd = selection.picking;
  const [cursor, setCursor] = useState(range.start.slice(0, 7));
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [close]);

  const presets = [
    { label: 'Today', start: today, end: today },
    { label: 'Yesterday', start: addDaysISO(today, -1), end: addDaysISO(today, -1) },
    { label: 'This week', start: weekStart, end: addDaysISO(weekStart, 6) },
    { label: 'Last 7 days', start: addDaysISO(today, -6), end: today },
    { label: 'This month', start: thisMonth.start, end: thisMonth.end },
    {
      label: 'Last month',
      start: monthBounds(lastMonth).start,
      end: monthBounds(lastMonth).end,
    },
    { label: 'Last 30 days', start: addDaysISO(today, -29), end: today },
    { label: 'This year', start: today.slice(0, 4) + '-01-01', end: today },
  ];

  const choose = (start: string, end: string) => {
    setSelection({ start, end, picking: false });
    setCursor(start.slice(0, 7));
  };
  const pickDay = (day: string) =>
    setSelection((prev) =>
      prev.picking
        ? {
            start: day < prev.start ? day : prev.start,
            end: day < prev.start ? prev.start : day,
            picking: false,
          }
        : { start: day, end: day, picking: true },
    );

  const [year, monthNum] = cursor.split('-').map(Number);
  const lead = (new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${cursor}-${String(d).padStart(2, '0')}`);
  const span = Math.round((Date.parse(draft.end) - Date.parse(draft.start)) / 86400000);
  const tooLong = span > 365;
  const isPreset = (p: { start: string; end: string }) =>
    p.start === draft.start && p.end === draft.end;

  return (
    <div className="period-pop" role="dialog" aria-label="Choose date range" ref={anchor}>
      <div className="period-presets">
        {presets.map((p) => (
          <button
            type="button"
            key={p.label}
            className="period-preset"
            aria-current={isPreset(p)}
            onClick={() => choose(p.start, p.end)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="cal-head">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous month"
          onClick={() => setCursor(addDaysISO(cursor + '-01', -1).slice(0, 7))}
        >
          <Icon name="chevron" className="muted" />
        </button>
        <span className="cal-title">{monthLabel(cursor)}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next month"
          onClick={() => setCursor(addDaysISO(cursor + '-28', 6).slice(0, 7))}
        >
          <Icon name="chevron" className="muted" />
        </button>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((d) => (
          <span className="cal-dow" key={d}>
            {d}
          </span>
        ))}
        {cells.map((day, i) =>
          day ? (
            <button
              type="button"
              key={day}
              className={
                'cal-day' +
                (day === draft.start || day === draft.end ? ' edge' : '') +
                (day > draft.start && day < draft.end ? ' in-range' : '')
              }
              onClick={() => pickDay(day)}
            >
              {Number(day.slice(8))}
            </button>
          ) : (
            <span key={'x' + i} />
          ),
        )}
      </div>
      <div className="period-foot">
        <span className="period-summary">
          {pickingEnd
            ? 'Pick an end date'
            : tooLong
              ? 'Range must be 366 days or less'
              : describePeriod(draft.start, draft.end)}
        </span>
        <div className="od-row">
          <button type="button" className="btn btn-sm" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={tooLong || !draft.start || !draft.end}
            onClick={() =>
              apply({
                start: draft.start,
                end: draft.end,
                label: describePeriod(draft.start, draft.end),
              })
            }
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
function HeroCard({ d }: { d: Any }) {
  const months = d.trends?.months ?? [];
  const series = months.map((m: Any) => m.net_worth);
  const netWorth = d.balances?.net_worth ?? { amount: '0', currency: d.currency };
  const prev = series.length > 1 ? series[series.length - 2] : num(netWorth);
  const change = num(netWorth) - (prev ?? num(netWorth));
  const pct = prev ? change / prev : 0;
  const up = change >= 0;
  return (
    <section className="card">
      <div className="hero">
        <div className="od-stack" style={gap('var(--sp-2)')}>
          <span className="eyebrow">Net worth</span>
          <span className="hero-value tnum">
            <CountUp
              value={num(netWorth)}
              format={(n) => fmtMoney({ amount: String(n), currency: d.currency })}
            />
          </span>
          <span className="hero-sub">
            <span className={'delta ' + (up ? 'up' : 'down')}>
              <Icon name={up ? 'arrowUp' : 'arrowDown'} />
              {up ? '+' : ''}
              {fmtMoney({ amount: String(change), currency: d.currency })}
              {prev ? ` (${fmtPct(pct, 1)})` : ''}
            </span>
            <span>vs. last month</span>
          </span>
          <Sparkline values={series} />
        </div>
        <div className="od-stack" style={gap('var(--sp-4)')}>
          <span className="eyebrow">Balance sheet</span>
          <Stat
            label="Assets"
            value={fmtMoney(d.balances?.assets)}
            caption="Cash and investments"
          />
          <hr className="divider" />
          <Stat
            label="Liabilities"
            value={fmtMoney(d.balances?.liabilities)}
            caption="Credit and loans"
          />
          <hr className="divider" />
          <Stat
            label="Available cash"
            value={fmtMoney(d.balances?.available_cash)}
            caption="Across depository accounts"
          />
        </div>
      </div>
    </section>
  );
}
function CashflowChart({ d }: { d: Any }) {
  const months = d.trends?.months ?? [];
  const max = Math.max(1, ...months.map((m: Any) => Math.max(m.income, m.spending)));
  return (
    <div className="cashflow">
      {months.map((m: Any) => {
        const ih = Math.max(2, (m.income / max) * 150);
        const sh = Math.max(2, (m.spending / max) * 150);
        const name = new Date(
          Number(m.month.slice(0, 4)),
          Number(m.month.slice(5)) - 1,
          1,
        ).toLocaleDateString('en-CA', { month: 'short' });
        return (
          <div className="cf-col" key={m.month}>
            <div
              className="cf-bars"
              title={`${name}: in ${fmtCompact(m.income)}, out ${fmtCompact(m.spending)}`}
            >
              <span className="cf-bar" style={{ height: `${ih.toFixed(0)}px` }} />
              <span className="cf-bar spend" style={{ height: `${sh.toFixed(0)}px` }} />
            </div>
            <span className="cf-label">{name}</span>
            <span className={'cf-net ' + (m.net >= 0 ? 'pos' : 'neg')}>{fmtCompact(m.net)}</span>
          </div>
        );
      })}
    </div>
  );
}
function buildInsights(
  d: Any,
  nav: (v: string) => void,
  onOpenAnomaly: (a: Any) => void,
): Insight[] {
  const out: Insight[] = [];
  for (const s of d.signals ?? []) {
    if (s.type === 'anomaly') {
      out.push({
        tone: severityTone(s.severity),
        icon: signalIcon(s.kind),
        title: label(s.kind),
        text: s.detail,
        meta: (
          <>
            <span className="row-amount">{fmtMoney(s.amount)}</span>
            <span className="stat-caption">{fmtDate(s.date)}</span>
          </>
        ),
        action: { label: 'Open', onClick: () => onOpenAnomaly(s) },
      });
    } else {
      out.push({
        tone: severityTone(s.severity) || 'warn',
        icon: 'repeat',
        title: s.title + ' price increased',
        text: s.detail,
        meta: <span className="stat-caption">{fmtDate(s.date)}</span>,
        action: { label: 'Review', onClick: () => nav('recurring') },
      });
    }
  }
  for (const a of d.attention ?? []) {
    out.push({
      tone: severityTone(a.severity) || 'warn',
      icon: 'trend',
      title: categoryName(d, a.category) + ' pacing high',
      text: `Projected ${fmtMoney(a.projected_month_spending)} vs a ${fmtMoney(a.historical_median)} median.`,
      action: { label: 'See spending', onClick: () => nav('insights') },
    });
  }
  return out.slice(0, 6);
}
function OverviewView({
  d,
  categories,
  nav,
  onOpenTx,
  noActivity: empty,
  goCad,
}: {
  d: Any;
  categories: Any[];
  nav: (v: string) => void;
  onOpenTx: (tx: Any) => void;
  noActivity: boolean;
  goCad: () => void;
}) {
  if (empty)
    return (
      <div className="content">
        <EmptyState
          title={'No ' + d.currency + ' activity'}
          body={`This workspace has no ${d.currency} accounts or transactions in the selected period. Currencies are always kept separate.`}
          action={{ label: 'Switch to CAD', onClick: goCad }}
        />
      </div>
    );
  const recent = (d.transactions ?? []).slice(0, 5);
  const insights = buildInsights(d, nav, (a) => {
    const t =
      (d.transactions ?? []).find((x: Any) => x.id === a.transaction_id) ??
      (d.largest ?? []).find((x: Any) => x.id === a.transaction_id);
    if (t) onOpenTx(t);
    else nav('transactions');
  });
  const max = Math.max(1, ...(d.categories ?? []).map((c: Any) => num(c.spending)));
  const catRows = (d.categories ?? []).slice(0, 6).map((c: Any, i: number) => (
    <div className="bar-row" key={c.name}>
      <span className="bar-name">{label(c.name)}</span>
      <span className="bar-track">
        <span
          className="bar-fill"
          style={{ width: ((num(c.spending) / max) * 100 || 0).toFixed(1) + '%' }}
        />
      </span>
      <span className="bar-val tnum">{fmtMoney(c.spending)}</span>
    </div>
  ));
  const rate = d.savings_rate;
  return (
    <div className="content">
      <HeroCard d={d} />
      <div className="grid-2">
        <Card title="Cash flow" extra={<span className="quiet">{periodText(d.period)}</span>}>
          <div className="od-stack" style={gap('var(--sp-4)')}>
            <div className="grid-3">
              <Stat label="Income" value={fmtMoney(d.income)} cls="pos" />
              <Stat label="Spending" value={fmtMoney(d.spending)} cls="neg" />
              <Stat
                label="Net"
                value={fmtMoney(d.net_cashflow)}
                cls={num(d.net_cashflow) >= 0 ? 'pos' : 'neg'}
              />
            </div>
            <CashflowChart d={d} />
            <div className="legend">
              <span className="legend-item">
                <span className="swatch" style={{ background: 'var(--positive)' }} />
                Income
              </span>
              <span className="legend-item">
                <span className="swatch" style={{ background: 'var(--negative)' }} />
                Spending
              </span>
              <span className="quiet">Six months · net labelled below each month</span>
            </div>
          </div>
        </Card>
        <Card
          title="Savings & commitments"
          extra={<span className="quiet">{periodText(d.period)}</span>}
        >
          <div className="od-stack" style={gap('var(--sp-4)')}>
            <div className="donut-wrap">
              <div className="ring-wrap">
                <Donut
                  parts={[{ ratio: Math.max(0, Math.min(1, rate ?? 0)), color: 'var(--brand)' }]}
                  size={148}
                  thickness={14}
                  label="Savings rate"
                />
                <span className="ring-center">
                  <strong>
                    <CountUp value={(rate ?? 0) * 100} format={(n) => n.toFixed(0) + '%'} />
                  </strong>
                  <span>saved</span>
                </span>
              </div>
              <div className="od-stack od-fill" style={gap('var(--sp-3)')}>
                <Stat
                  label="Pending commitments"
                  value={fmtMoney(d.pending)}
                  caption="Not yet settled"
                />
                <hr className="divider" />
                <Stat
                  label="Unclassified inflows"
                  value={fmtMoney(d.unclassified_inflows)}
                  caption="Needs a category"
                />
                <hr className="divider" />
                <Stat
                  label="Refunds netted"
                  value={String(d.refunds_netted ?? 0)}
                  caption="Reduced spending"
                />
              </div>
            </div>
            <p className="quiet">
              Savings rate is income less settled spending, divided by income.
            </p>
          </div>
        </Card>
      </div>
      <section className="section">
        <div className="section-head">
          <h2>Needs attention</h2>
          <span className="hint">{insights.length} items</span>
        </div>
        {insights.length ? (
          <div className="grid-2">
            {insights.map((i, idx) => (
              <InsightCard key={idx} {...i} />
            ))}
          </div>
        ) : (
          <p className="quiet">Nothing needs your attention right now.</p>
        )}
      </section>
      <div className="grid-2">
        <Card
          title="Where money went"
          extra={
            <button className="btn btn-sm" onClick={() => nav('insights')}>
              Details
            </button>
          }
        >
          {catRows.length ? catRows : <p className="quiet">No settled spending for this period.</p>}
          <p className="quiet" style={{ marginTop: 'var(--sp-3)' }}>
            Transfers excluded. Refunds reduce spending on their posting date.
          </p>
        </Card>
        <Card
          title="Recent activity"
          extra={
            <button className="btn btn-sm" onClick={() => nav('transactions')}>
              All transactions
            </button>
          }
        >
          <div>
            {recent.map((t: Any) => (
              <button
                className="row"
                key={t.id}
                onClick={() => onOpenTx(t)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 0,
                  borderBottom: '1px solid var(--hairline-2)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span className="avatar">
                  <Icon name={CAT_ICON[t.category_id] || 'receipt'} />
                </span>
                <span className="od-fill">
                  <span className="row-title">{t.merchant}</span>
                  <span className="row-sub">
                    {fmtDate(t.date)} · {categoryName(d, t.category_id)}
                  </span>
                </span>
                <span
                  className={
                    'row-amount tnum ' +
                    (num(t.amount) > 0 ? 'pos' : num(t.amount) < 0 ? 'neg' : '')
                  }
                >
                  {fmtMoney(t.amount)}
                </span>
              </button>
            ))}
            {!recent.length && <p className="quiet">No transactions in this period.</p>}
          </div>
        </Card>
      </div>
      <section className="section">
        <div className="section-head">
          <h2>Your accounts</h2>
          <button className="btn btn-sm" onClick={() => nav('accounts')}>
            Manage
          </button>
        </div>
        <div className="grid-4">
          {(d.balances?.accounts ?? []).map((a: Any) => (
            <div className="card card-flat" style={{ padding: 'var(--sp-4)' }} key={a.id}>
              <div className="od-row" style={{ justifyContent: 'space-between' }}>
                <span className="quiet">{label(a.type)}</span>
                <Icon
                  name={a.type === 'credit' || a.type === 'loan' ? 'cards' : 'wallet'}
                  className="muted"
                />
              </div>
              <div className="row-title" style={{ marginTop: 'var(--sp-2)' }}>
                {a.name}
              </div>
              <div
                className="stat-value tnum"
                style={{ fontSize: 'var(--fs-2xl)', marginTop: 'var(--sp-1)' }}
              >
                {fmtMoney(a.current)}
              </div>
              <div className="stat-caption">Updated {relTime(a.observed_at)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TransactionsView(props: {
  d: Any;
  categories: Any[];
  accounts: Any[];
  query: string;
  setQuery: (s: string) => void;
  search: string;
  setSearch: (s: string) => void;
  month: string;
  setMonth: (s: string) => void;
  filterCategory: string;
  setFilterCategory: (v: string) => void;
  filterAccount: string;
  setFilterAccount: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (v: string) => void;
  cursor: string | null;
  setCursor: (v: string | null) => void;
  onOpenTx: (tx: Any) => void;
}) {
  const {
    d,
    categories,
    accounts,
    query,
    setQuery,
    search,
    setSearch,
    month,
    setMonth,
    filterCategory,
    setFilterCategory,
    filterAccount,
    setFilterAccount,
    filterStatus,
    setFilterStatus,
    cursor,
    setCursor,
    onOpenTx,
  } = props;
  const list: Any[] = d.transactions ?? [];
  const dirty =
    Boolean(search || filterCategory || filterAccount || filterStatus) ||
    month !== new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }).slice(0, 7);
  return (
    <div className="content">
      <section className="toolbar card card-flat" style={{ padding: 'var(--sp-4)' }}>
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query);
          }}
        >
          <label className="sr-only" htmlFor="tx-search">
            Search transactions
          </label>
          <input
            className="input"
            id="tx-search"
            type="search"
            placeholder="Search merchant or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        <div className="field">
          <label htmlFor="f-month">Month</label>
          <input
            className="input"
            id="f-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="f-cat">Category</label>
          <select
            className="select"
            id="f-cat"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-acc">Account</label>
          <select
            className="select"
            id="f-acc"
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select
            className="select"
            id="f-status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="settled">Settled</option>
            <option value="pending">Pending</option>
            <option value="unclassified">Needs classification</option>
            <option value="excluded">Excluded</option>
          </select>
        </div>
        {dirty && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setQuery('');
              setSearch('');
              setFilterCategory('');
              setFilterAccount('');
              setFilterStatus('');
              setMonth(
                new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }).slice(0, 7),
              );
              setCursor(null);
            }}
          >
            Clear filters
          </button>
        )}
      </section>
      {list.length ? (
        <section>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Merchant</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((t: Any) => (
                  <tr key={t.id} onClick={() => onOpenTx(t)} tabIndex={0}>
                    <td className="date-cell" data-label="Date">
                      {fmtDate(t.date)}
                    </td>
                    <td data-label="Merchant">
                      <span className="cell-merchant">
                        <span className="avatar">
                          <Icon name={CAT_ICON[t.category_id] || 'receipt'} />
                        </span>
                        <span className="od-fill">
                          <span className="row-title">{t.merchant}</span>
                          <span className="row-sub">{t.account_name || ''}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Category">
                      <span className="chip">{categoryName(d, t.category_id)}</span>
                    </td>
                    <td data-label="Status">
                      <span
                        className={
                          'pill ' + (t.pending ? 'pill-warn' : t.excluded ? '' : 'pill-pos')
                        }
                      >
                        {t.pending ? 'Pending' : label(t.kind)}
                      </span>
                    </td>
                    <td
                      className={'num ' + (num(t.amount) > 0 ? 'pos' : num(t.amount) < 0 ? 'neg' : '')}
                      data-label="Amount"
                    >
                      {fmtMoney(t.amount)}
                    </td>
                    <td className="cell-action">
                      <button
                        className="btn btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTx(t);
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination" style={{ marginTop: 'var(--sp-4)' }}>
            <span>{list.length} shown</span>
            <span className="od-row">
              {cursor && (
                <button className="btn btn-sm" onClick={() => setCursor(null)}>
                  First page
                </button>
              )}
              {d.next_cursor && (
                <button className="btn btn-sm" onClick={() => setCursor(d.next_cursor)}>
                  Next page
                </button>
              )}
            </span>
          </div>
        </section>
      ) : (
        <EmptyState
          title="No matching transactions"
          body="Try a different month, clear a filter, or connect an institution on the Accounts page."
          action={{
            label: 'Clear filters',
            onClick: () => {
              setQuery('');
              setSearch('');
              setFilterCategory('');
              setFilterAccount('');
              setFilterStatus('');
              setCursor(null);
            },
          }}
        />
      )}
    </div>
  );
}

function InsightsView({
  d,
  nav,
  onOpenTx,
  onReviewed,
}: {
  d: Any;
  nav: (v: string) => void;
  onOpenTx: (tx: Any) => void;
  onReviewed: (id: string) => void;
}) {
  const max = Math.max(1, ...(d.categories ?? []).map((c: Any) => num(c.spending)));
  const catRows = (d.categories ?? []).map((c: Any) => (
    <div className="bar-row" key={c.name}>
      <span className="bar-name">{label(c.name)}</span>
      <span className="bar-track">
        <span
          className="bar-fill"
          style={{ width: ((num(c.spending) / max) * 100 || 0).toFixed(1) + '%' }}
        />
      </span>
      <span className="bar-val tnum">
        {fmtMoney(c.spending)}
        {c.delta != null && (
          <span
            className={'pill ' + (c.delta > 0.1 ? 'pill-neg' : c.delta < 0 ? 'pill-pos' : '')}
            style={{ marginLeft: 'var(--sp-2)' }}
          >
            {(c.delta > 0 ? '+' : '') + fmtPct(c.delta)}
          </span>
        )}
      </span>
    </div>
  ));
  const top = (d.categories ?? []).slice(0, 6);
  const totalSpend = num(d.spending) || 1;
  const donutParts = top.map((c: Any, i: number) => ({
    ratio: num(c.spending) / totalSpend,
    color: CAT_COLORS[i],
  }));
  const legend = top.map((c: Any, i: number) => (
    <div className="row" key={c.name}>
      <span className="swatch" style={{ background: CAT_COLORS[i] }} />
      <span className="od-fill">{label(c.name)}</span>
      <span className="tnum">{fmtMoney(c.spending)}</span>
    </div>
  ));
  const merchants = (d.merchants ?? []).slice(0, 8).map((m: Any) => (
    <div className="row" key={m.name}>
      <span className="avatar">
        <Icon name="bag" />
      </span>
      <span className="od-fill">
        <span className="row-title">{m.name}</span>
        <span className="row-sub">{m.transaction_count} charges</span>
      </span>
      <span className="row-amount tnum">{fmtMoney(m.spending)}</span>
    </div>
  ));
  const largest = (d.largest ?? []).map((t: Any) => (
    <button
      className="row"
      key={t.id}
      onClick={() => onOpenTx(t)}
      style={{
        width: '100%',
        background: 'transparent',
        border: 0,
        borderBottom: '1px solid var(--hairline-2)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span className="od-fill">
        <span className="row-title">{t.merchant}</span>
        <span className="row-sub">{fmtDate(t.date)}</span>
      </span>
      <span className="row-amount tnum">{fmtMoney(t.amount)}</span>
    </button>
  ));
  const signals = (d.signals ?? []).map((s: Any) => {
    const isAnomaly = s.type === 'anomaly';
    return (
      <InsightCard
        key={s.id}
        tone={severityTone(s.severity)}
        icon={signalIcon(s.kind)}
        title={isAnomaly ? label(s.kind) : s.title + ' price increased'}
        text={s.detail}
        meta={
          <>
            <span className="row-amount">{fmtMoney(s.amount)}</span>
            <span className="stat-caption">
              {fmtDate(s.date)} · {s.severity || 'medium'}
            </span>
          </>
        }
        action={
          isAnomaly
            ? { label: 'Mark reviewed', onClick: () => onReviewed(s.id) }
            : { label: 'Review', onClick: () => nav('recurring') }
        }
      />
    );
  });
  return (
    <div className="content">
      <div className="grid-4">
        <Card extra={<span className="eyebrow">This month</span>}>
          <Stat
            label="Settled spending"
            value={fmtMoney(d.spending)}
            caption="Excludes transfers"
            cls="neg"
          />
        </Card>
        <Card extra={<span className="eyebrow">This month</span>}>
          <Stat label="Income" value={fmtMoney(d.income)} cls="pos" />
        </Card>
        <Card extra={<span className="eyebrow">This month</span>}>
          <Stat
            label="Net cash flow"
            value={fmtMoney(d.net_cashflow)}
            cls={num(d.net_cashflow) >= 0 ? 'pos' : 'neg'}
          />
        </Card>
        <Card extra={<span className="eyebrow">This month</span>}>
          <Stat
            label="Savings rate"
            value={fmtPct(d.savings_rate)}
            caption="Of income retained"
            cls="pos"
          />
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Spending by category">
          <div className="donut-wrap">
            <div>
              <Donut parts={donutParts} size={156} thickness={18} label="Category share" />
            </div>
            <div className="donut-legend od-fill">{legend}</div>
          </div>
        </Card>
        <Card title="Share and change">
          {catRows.length ? catRows : <p className="quiet">No settled spending for this period.</p>}
          <p className="quiet" style={{ marginTop: 'var(--sp-3)' }}>
            Change compares this month with the prior three-month median.
          </p>
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Top merchants">
          {merchants.length ? merchants : <p className="quiet">No merchants yet.</p>}
        </Card>
        <Card title="Largest transactions">
          {largest.length ? largest : <p className="quiet">No transactions yet.</p>}
        </Card>
      </div>
      <section className="section">
        <div className="section-head">
          <h2>Signals</h2>
          <span className="hint">{signals.length} open · all time</span>
        </div>
        {signals.length ? (
          <div className="grid-2">{signals}</div>
        ) : (
          <p className="quiet">
            No open signals. Anomalies and price changes appear here and stay until you review them.
          </p>
        )}
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Pace signals</h2>
          <span className="hint">
            Projected from {d.pace?.days_elapsed ?? '—'} of {d.pace?.days_in_month ?? '—'} days
          </span>
        </div>
        <div className="grid-2">
          {(d.attention ?? []).map((a: Any) => (
            <Card
              title={categoryName(d, a.category)}
              key={a.category}
              extra={
                <span
                  className={
                    'pill ' +
                    (severityTone(a.severity) === 'neg'
                      ? 'pill-neg'
                      : severityTone(a.severity) === 'warn'
                        ? 'pill-warn'
                        : 'pill-info')
                  }
                >
                  {label(a.severity || 'signal')}
                </span>
              }
            >
              <div className="od-row" style={{ justifyContent: 'space-between' }}>
                <span className="quiet">Spent to date</span>
                <span className="row-amount">{fmtMoney(a.spent_to_date)}</span>
              </div>
              <div className="od-row" style={{ justifyContent: 'space-between' }}>
                <span className="quiet">Projected month</span>
                <span className="row-amount">{fmtMoney(a.projected_month_spending)}</span>
              </div>
              <div className="od-row" style={{ justifyContent: 'space-between' }}>
                <span className="quiet">3-month median</span>
                <span className="row-amount">
                  {a.historical_median ? fmtMoney(a.historical_median) : '—'}
                </span>
              </div>
              <div className="od-row" style={{ justifyContent: 'space-between' }}>
                <span className="quiet">
                  {a.ratio_to_median != null
                    ? `${a.ratio_to_median >= 1 ? '+' : ''}${fmtPct(a.ratio_to_median - 1)} vs median`
                    : 'No baseline'}
                </span>
                <span className="pill">
                  {a.confidence === 'low' ? 'Low confidence' : 'Forecast'}
                </span>
              </div>
            </Card>
          ))}
        </div>
        {!(d.attention ?? []).length && (
          <p className="quiet">No category is projected to run hot this month.</p>
        )}
      </section>
    </div>
  );
}

function RecurringView({
  d,
  noActivity: empty,
  goCad,
}: {
  d: Any;
  noActivity: boolean;
  goCad: () => void;
}) {
  if (empty)
    return (
      <div className="content">
        <EmptyState
          title={'No ' + d.currency + ' activity'}
          body={`This workspace has no ${d.currency} commitments in the selected period.`}
          action={{ label: 'Switch to CAD', onClick: goCad }}
        />
      </div>
    );
  const series = (d.series ?? [])
    .slice()
    .sort((a: Any, b: Any) => (a.next_expected_date < b.next_expected_date ? -1 : 1));
  const rows = series.map((r: Any) => {
    const increased = num(r.price_change) > 0;
    return (
      <div className="row" key={r.id}>
        <span className="avatar">
          <Icon name="repeat" />
        </span>
        <span className="od-fill">
          <span className="row-title">{r.merchant}</span>
          <span className="row-sub">
            {label(r.frequency)} · next {fmtDateLong(r.next_expected_date)} ·{' '}
            {Math.round(r.confidence * 100)}% confidence
          </span>
        </span>
        {increased && (
          <span className="pill pill-neg">
            <Icon name="arrowUp" />+{fmtMoney(r.price_change)}
          </span>
        )}
        <span className="row-amount tnum">{fmtMoney(r.amount)}</span>
      </div>
    );
  });
  return (
    <div className="content">
      <section className="card">
        <div className="hero">
          <div className="od-stack" style={gap('var(--sp-2)')}>
            <span className="eyebrow">Estimated monthly commitments</span>
            <span className="hero-value tnum">{fmtMoney(d.monthly_total)}</span>
            <span className="hero-sub">
              <span>{series.length} active series</span>
              <span>·</span>
              <span>
                {series.filter((r: Any) => num(r.price_change) > 0).length} with price increases
              </span>
            </span>
          </div>
          {series[0] && (
            <div className="od-stack" style={gap('var(--sp-4)')}>
              <Stat
                label="Next charge"
                value={fmtMoney(series[0].amount)}
                caption={`${series[0].merchant} · ${fmtDateLong(series[0].next_expected_date)}`}
              />
              <hr className="divider" />
              <Stat
                label="Annualised"
                value={fmtMoney({
                  amount: String(num(d.monthly_total) * 12),
                  currency: d.currency,
                })}
                caption="At the current run rate"
              />
            </div>
          )}
        </div>
      </section>
      <Card
        title="Subscriptions and bills"
        extra={<span className="quiet">Three or more consistent charges</span>}
      >
        {rows.length ? rows : <p className="quiet">No recurring series detected yet.</p>}
      </Card>
      {(d.possible ?? []).length > 0 && (
        <Card
          title="Possibly recurring"
          extra={<span className="quiet">Only two charges so far · excluded from the total</span>}
        >
          {(d.possible ?? []).map((r: Any) => (
            <div className="row" key={r.id}>
              <span className="avatar">
                <Icon name="repeat" />
              </span>
              <span className="od-fill">
                <span className="row-title">{r.merchant}</span>
                <span className="row-sub">
                  {label(r.frequency)} · last {fmtDateLong(r.last_seen)} ·{' '}
                  {Math.round(r.confidence * 100)}% confidence
                </span>
              </span>
              <span className="row-amount tnum">{fmtMoney(r.amount)}</span>
            </div>
          ))}
        </Card>
      )}
      <p className="quiet">
        Recurring detection uses observation intervals and amount tolerance; it is not a guarantee
        of a future bill.
      </p>
    </div>
  );
}

function BudgetView({
  d,
  categories,
  currency,
  start,
  busy,
  save,
  noActivity: empty,
  goCad,
}: {
  d: Any;
  categories: Any[];
  currency: string;
  start: string;
  busy: boolean;
  save: (body: Any) => Promise<boolean>;
  noActivity: boolean;
  goCad: () => void;
}) {
  if (empty)
    return (
      <div className="content">
        <EmptyState
          title={'No ' + d.currency + ' budget'}
          body={`No budget has been set for ${d.currency}.`}
          action={{ label: 'Switch to CAD', onClick: goCad }}
        />
      </div>
    );
  const elapsed = d.elapsed_fraction ?? 0;
  const overallRatio = num(d.overall?.limit) ? num(d.overall.actual) / num(d.overall.limit) : 0;
  const rows = (d.categories ?? []).map((c: Any) => {
    const ratio = c.utilization ?? 0;
    const cls = c.status === 'over_budget' ? 'over' : c.status === 'ahead_of_pace' ? 'warn' : '';
    return (
      <div key={c.category}>
        <div className="bar-row">
          <span className="bar-name">{categoryName(d, c.category)}</span>
          <span className="bar-track">
            <span
              className={'bar-fill ' + cls}
              style={{ width: Math.min(100, ratio * 100).toFixed(1) + '%' }}
            />
            <span
              className="pace-marker"
              style={{ left: (elapsed * 100).toFixed(1) + '%' }}
              title={'Pace: ' + fmtPct(elapsed) + ' of month elapsed'}
            />
          </span>
          <span className="bar-val tnum">
            {fmtMoney(c.actual)} <span className="muted">/ {fmtMoney(c.limit)}</span>
          </span>
        </div>
        <div className="od-row" style={{ justifyContent: 'flex-end', marginBottom: 'var(--sp-2)' }}>
          <span className={'pill ' + statusTone(c.status)}>{label(c.status)}</span>
        </div>
      </div>
    );
  });
  return (
    <div className="content">
      <Card title="Monthly budget" extra={<span className="quiet">{monthLabel(d.month)}</span>}>
        <div className="od-stack" style={gap('var(--sp-4)')}>
          <div className="grid-3">
            <Stat label="Budgeted" value={fmtMoney(d.overall?.limit)} />
            <Stat label="Spent" value={fmtMoney(d.overall?.actual)} />
            <Stat
              label="Remaining"
              value={fmtMoney({
                amount: String(num(d.overall?.limit) - num(d.overall?.actual)),
                currency: d.currency,
              })}
              caption={fmtPct(1 - overallRatio) + ' of budget left'}
            />
          </div>
          <div className="bar-track" style={{ height: 12 }}>
            <span
              className={'bar-fill ' + (overallRatio > 1 ? 'over' : '')}
              style={{ width: Math.min(100, overallRatio * 100).toFixed(1) + '%' }}
            />
            <span className="pace-marker" style={{ left: (elapsed * 100).toFixed(1) + '%' }} />
          </div>
          <p className="quiet">
            {fmtPct(elapsed)} of {monthLabel(d.month)} has elapsed. The marker shows the pace line.
          </p>
        </div>
      </Card>
      <Card title="Category limits">
        {rows.length ? rows : <p className="quiet">No category limits set.</p>}
        <p className="quiet" style={{ marginTop: 'var(--sp-3)' }}>
          Bars turn amber ahead of pace and red over budget.
        </p>
      </Card>
      <Card title="Set a limit">
        <form
          className="form-grid"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const category_id = String(f.get('category'));
            const lines = (d.categories ?? [])
              .filter((c: Any) => c.category !== category_id)
              .map((c: Any) => ({ category_id: c.category, limit: String(c.limit.amount) }));
            lines.push({ category_id, limit: String(f.get('limit')) });
            void save({ name: 'Monthly budget', currency, start_date: start, lines });
          }}
        >
          <div className="field">
            <label htmlFor="b-cat">Category</label>
            <select className="select" id="b-cat" name="category" required>
              {categories
                .filter((c) => c.type === 'spending')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="b-limit">Monthly limit ({currency})</label>
            <input
              className="input"
              id="b-limit"
              name="limit"
              type="number"
              min="0"
              step="0.01"
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            style={{ alignSelf: 'end' }}
            disabled={busy}
          >
            Save limit
          </button>
        </form>
      </Card>
    </div>
  );
}

function ReportsView({
  d,
  selectedReport,
  setSelectedReport,
  generate,
  busy,
  noActivity: empty,
  goCad,
  start,
  end,
  currency,
}: {
  d: Any;
  selectedReport: Any;
  setSelectedReport: (r: Any) => void;
  generate: (type: string, s: string, e: string) => Promise<boolean>;
  busy: boolean;
  noActivity: boolean;
  goCad: () => void;
  start: string;
  end: string;
  currency: string;
}) {
  if (empty)
    return (
      <div className="content">
        <EmptyState
          title={'No ' + currency + ' reports'}
          body={`No saved calculations for ${currency}.`}
          action={{ label: 'Switch to CAD', onClick: goCad }}
        />
      </div>
    );
  const list: Any[] = Array.isArray(d) ? d : (d.items ?? []);
  const r = selectedReport;
  const detail = r ? (
    <section className="section">
      <div className="section-head">
        <h2>{label(r.report_type)} review</h2>
        <button className="btn btn-sm" onClick={() => setSelectedReport(null)}>
          Close
        </button>
      </div>
      <Card>
        <div className="grid-3">
          <Stat label="Income" value={fmtMoney(r.headline?.income)} cls="pos" />
          <Stat label="Spending" value={fmtMoney(r.headline?.spending)} cls="neg" />
          <Stat
            label="Net cash flow"
            value={fmtMoney(r.headline?.net_cashflow)}
            cls={num(r.headline?.net_cashflow) >= 0 ? 'pos' : 'neg'}
          />
        </div>
        <div className="od-stack" style={{ ...gap('var(--sp-4)'), marginTop: 'var(--sp-4)' }}>
          <div className="od-row" style={{ justifyContent: 'space-between' }}>
            <span className="quiet">Savings rate</span>
            <span className="row-amount">{fmtPct(r.savings_rate)}</span>
          </div>
          <hr className="divider" />
          <span className="eyebrow">Top categories</span>
          {(r.spending?.categories ?? []).slice(0, 3).map((c: Any) => (
            <div className="od-row" style={{ justifyContent: 'space-between' }} key={c.name}>
              <span>{label(c.name)}</span>
              <span className="row-amount">{fmtMoney(c.spending)}</span>
            </div>
          ))}
          <hr className="divider" />
          <span className="eyebrow">Caveats</span>
          {(r.caveats ?? []).map((c: string, i: number) => (
            <p className="quiet" key={i}>
              {c}
            </p>
          ))}
          <details>
            <summary className="quiet">View structured data</summary>
            <pre>{JSON.stringify(r, null, 2)}</pre>
          </details>
        </div>
      </Card>
    </section>
  ) : null;
  return (
    <div className="content">
      <section className="toolbar card card-flat" style={{ padding: 'var(--sp-4)' }}>
        <p className="quiet od-fill" style={{ margin: 0 }}>
          Generate a saved review, or let the weekly and monthly schedule build your history.
        </p>
        <button className="btn" disabled={busy} onClick={() => generate('monthly', start, end)}>
          Generate monthly report
        </button>
        <button className="btn" disabled={busy} onClick={() => generate('weekly', start, end)}>
          Generate weekly report
        </button>
      </section>
      <Card title="Saved reports">
        {list.length ? (
          list.map((rep: Any) => (
            <button
              className="row"
              key={rep.id}
              style={{
                width: '100%',
                background: 'transparent',
                border: 0,
                borderBottom: '1px solid var(--hairline-2)',
                textAlign: 'left',
                cursor: 'pointer',
              }}
              onClick={() =>
                api('/api/reports/' + rep.id)
                  .then(setSelectedReport)
                  .catch(() => undefined)
              }
            >
              <span className="avatar">
                <Icon name="file" />
              </span>
              <span className="od-fill">
                <span className="row-title">{label(rep.report_type)} review</span>
                <span className="row-sub">
                  {fmtDateLong(rep.period_start)} – {fmtDateLong(rep.period_end)} · generated{' '}
                  {fmtDateTime(rep.generated_at)}
                </span>
              </span>
              <span className="od-row">
                <Icon name="chevron" className="muted" />
              </span>
            </button>
          ))
        ) : (
          <p className="quiet">No reports yet.</p>
        )}
      </Card>
      {detail}
    </div>
  );
}

function AccountsView({
  d,
  accounts,
  demo,
  busy,
  connect,
  mutate,
  confirm,
}: {
  d: Any;
  accounts: Any[];
  demo: boolean;
  busy: boolean;
  connect: (id?: string) => void;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
  confirm: (c: Any) => void;
}) {
  const list: Any[] = Array.isArray(d) ? d : (d.connections ?? []);
  const conns = list.map((i: Any) => (
    <div key={i.id} className="card card-flat" style={{ marginBottom: 'var(--sp-4)' }}>
      <div className="od-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="od-stack" style={gap('var(--sp-1)')}>
          <span className="row-title">{i.institution_name}</span>
          <span className="row-sub">
            Last sync {relTime(i.last_successful_sync_at)} ·{' '}
            {i.history_complete ? 'history loaded' : 'history incomplete'}
          </span>
        </div>
        <span className={'pill ' + statusTone(i.status)}>{label(i.status)}</span>
      </div>
      <div className="actions od-cluster" style={{ marginTop: 'var(--sp-4)' }}>
        {i.disconnected_at ? (
          <span className="quiet">Disconnected</span>
        ) : (
          <>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => mutate(`/api/plaid/items/${i.id}/sync`, {})}
            >
              <Icon name="refresh" />
              Sync
            </button>
            <button className="btn btn-sm" disabled={busy || demo} onClick={() => connect(i.id)}>
              <Icon name="link" />
              Reconnect
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                confirm({
                  title: 'Disconnect institution',
                  body: 'Disconnect this institution and keep its financial history? You can reconnect later.',
                  confirmLabel: 'Disconnect',
                  path: `/api/plaid/items/${i.id}/disconnect`,
                })
              }
            >
              Disconnect
            </button>
          </>
        )}
        <button
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={() => {
            const confirmation = prompt(
              `Permanently delete this institution's financial history and all saved reports? Type DELETE ${i.id}`,
            );
            if (confirmation) void mutate(`/api/plaid/items/${i.id}/delete`, { confirmation });
          }}
        >
          Delete history
        </button>
      </div>
    </div>
  ));
  const groups = ['depository', 'credit', 'loan'];
  return (
    <div className="content">
      <Card
        title="Connections"
        extra={<span className="quiet">Read-only · tokens stay encrypted</span>}
      >
        {conns.length ? (
          <>
            {conns}
            {demo ? (
              <p className="quiet">
                Bank connections are disabled in the synthetic preview. Open the Worker locally to
                use Plaid.
              </p>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={() => connect()}>
                <Icon name="link" />
                Add another institution
              </button>
            )}
          </>
        ) : (
          <EmptyState
            title="No institutions connected"
            body="Your permanent bank access token stays encrypted on the server."
            action={demo ? undefined : { label: 'Connect institution', onClick: () => connect() }}
          />
        )}
      </Card>
      <Card title="Accounts">
        {groups.map((g) => {
          const group = accounts.filter((a) => a.type === g);
          if (!group.length) return null;
          return (
            <div className="od-stack" style={gap('var(--sp-2)')} key={g}>
              <span className="eyebrow">{label(g)}</span>
              {group.map((a) => (
                <div className="row" key={a.id}>
                  <span className="avatar">
                    <Icon name={g === 'depository' ? 'wallet' : 'cards'} />
                  </span>
                  <span className="od-fill">
                    <span className="row-title">{a.name}</span>
                    <span className="row-sub">
                      Updated {relTime(a.observed_at)}
                      {a.available ? ' · ' + fmtMoney(a.available) + ' available' : ''}
                    </span>
                  </span>
                  <button
                    className="icon-btn"
                    aria-label="Rename account"
                    title="Rename account"
                    disabled={busy || demo}
                    onClick={() => {
                      const next = prompt('Account name', a.name);
                      if (next === null) return;
                      void mutate(
                        `/api/accounts/${a.id}`,
                        { name: next.trim() || null },
                        'PATCH',
                      );
                    }}
                  >
                    <Icon name="edit" />
                  </button>
                  <span className="row-amount tnum">{fmtMoney(a.current)}</span>
                </div>
              ))}
            </div>
          );
        })}
        {!accounts.length && <p className="quiet">No accounts in this currency.</p>}
      </Card>
      <p className="quiet">
        Every balance is separated by currency. Current balance comes from the last snapshot; this
        does not request an on-demand refresh.
      </p>
    </div>
  );
}

function HealthView({ d, nav }: { d: Any; nav: (v: string) => void }) {
  const f = d;
  const events = f.events ?? [];
  const rc = f.review_counts ?? {};
  return (
    <div className="content">
      <div className="grid-4">
        <Card>
          <Stat
            label="Coverage"
            value={f.coverage_complete ? 'Complete' : 'Incomplete'}
            cls={f.coverage_complete ? 'pos' : 'warn'}
          />
        </Card>
        <Card>
          <Stat
            label="Reconciliation"
            value={f.integrity?.ok ? 'Passed' : 'Pending'}
            cls={f.integrity?.ok ? 'pos' : 'warn'}
          />
        </Card>
        <Card>
          <Stat
            label="Classification"
            value={f.classification_complete ? 'Complete' : 'Needs review'}
            cls={f.classification_complete ? 'pos' : 'warn'}
          />
        </Card>
        <Card>
          <Stat
            label="Unknown currency"
            value={String(f.unknown_currency_transactions ?? 0)}
            caption="Transactions"
            cls={f.unknown_currency_transactions ? 'warn' : 'pos'}
          />
        </Card>
      </div>
      <Card title="Review queue">
        <div className="grid-3">
          <Stat
            label="Unmatched inflows"
            value={String(rc.unknown_inflows ?? 0)}
            caption="Need a category"
          />
          <Stat
            label="Duplicate candidates"
            value={String(rc.duplicate_candidates ?? 0)}
            caption="Possible repeats"
          />
          <Stat
            label="Disappeared accounts"
            value={String(rc.disappeared_accounts ?? 0)}
            caption="Missing from sync"
          />
        </div>
        <div className="od-row" style={{ marginTop: 'var(--sp-4)' }}>
          <button className="btn btn-sm" onClick={() => nav('insights')}>
            Review anomalies
          </button>
          <button className="btn btn-sm" onClick={() => nav('transactions')}>
            Open transactions
          </button>
        </div>
      </Card>
      <div className="grid-2">
        <Card title="Institution freshness">
          {(f.institutions ?? []).map((i: Any) => (
            <div className="row" key={i.id}>
              <span className="avatar">
                <Icon name="bank" />
              </span>
              <span className="od-fill">
                <span className="row-title">{i.institution}</span>
                <span className="row-sub">
                  Last success {relTime(i.last_successful_sync)} ·{' '}
                  {i.history_complete ? 'history complete' : 'history incomplete'}
                </span>
              </span>
              <span className={'pill ' + statusTone(i.status)}>{label(i.status)}</span>
            </div>
          ))}
          {!(f.institutions ?? []).length && <p className="quiet">No institutions connected.</p>}
        </Card>
        <Card title="Open events">
          {events.length ? (
            events.map((e: Any, i: number) => (
              <div
                className={'banner ' + (e.severity === 'error' ? 'banner-neg' : 'banner-warn')}
                style={{ marginBottom: 'var(--sp-2)' }}
                key={i}
              >
                <Icon name={e.severity === 'error' ? 'alert' : 'info'} />
                <div className="banner-body">
                  <strong>{label(e.kind)}</strong> · {e.message}
                  <div className="stat-caption">{fmtDateTime(e.created_at)}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="quiet">No open events.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function SettingsView({
  d,
  categories,
  currency,
  busy,
  version,
  mutate,
  dark,
  toggleTheme,
  mcpOrigin,
  demo,
  logout,
}: {
  d: Any;
  categories: Any[];
  currency: string;
  busy: boolean;
  version: number;
  mutate: (path: string, body: unknown, method?: string) => Promise<boolean>;
  dark: boolean;
  toggleTheme: () => void;
  setupRequired: boolean;
  mcpOrigin: string;
  demo: boolean;
  logout: () => void;
}) {
  const goals: Any[] = Array.isArray(d) ? d : (d.items ?? []);
  const [editing, setEditing] = useState<Any>(null);
  const [rules, setRules] = useState<Any[]>([]);
  const [grants, setGrants] = useState<Any[]>([]);
  useEffect(() => {
    api('/api/rules')
      .then(setRules)
      .catch(() => setRules([]));
  }, [version]);
  useEffect(() => {
    if (!demo)
      api('/api/oauth/grants')
        .then((r) => setGrants(r.items ?? []))
        .catch(() => setGrants([]));
  }, [demo, version]);
  const goalRows = goals.map((g: Any) => (
    <div className="goal" key={g.id}>
      <div className="ring-wrap">
        <Donut
          parts={[{ ratio: g.progress ?? 0, color: 'var(--brand)' }]}
          size={72}
          thickness={8}
          label={g.name + ' progress'}
        />
        <span className="ring-center">
          <strong style={{ fontSize: 'var(--fs-lg)' }}>{fmtPct(g.progress)}</strong>
        </span>
      </div>
      <div className="od-stack" style={gap('var(--sp-2)')}>
        <div className="od-row" style={{ justifyContent: 'space-between' }}>
          <span className="row-title">{g.name}</span>
          <button className="btn btn-sm" onClick={() => setEditing(g)}>
            Edit
          </button>
        </div>
        <span className="row-sub">
          {label(g.type)}
          {g.target_date ? ' · target ' + fmtDateLong(g.target_date) : ''}
        </span>
        <span className="progress">
          <span style={{ width: ((g.progress ?? 0) * 100).toFixed(1) + '%' }} />
        </span>
        <span className="row-sub tnum">
          {fmtMoney(g.current)} of {fmtMoney(g.target)}
        </span>
      </div>
    </div>
  ));
  return (
    <div className="content">
      <Card title="Financial goals">
        {goalRows.length ? goalRows : <p className="quiet">No goals yet.</p>}
        <div className="divider" style={{ marginTop: 'var(--sp-4)' }} />
        <form
          className="form-grid"
          style={{ marginTop: 'var(--sp-4)' }}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await mutate(
              '/api/goals/' + (editing?.id ?? crypto.randomUUID()),
              {
                name: f.get('name'),
                type: f.get('type'),
                target: f.get('target'),
                current: f.get('current'),
                currency,
                target_date: f.get('date') || null,
              },
              'PUT',
            );
            if (ok) setEditing(null);
          }}
        >
          <div className="field">
            <label htmlFor="g-name">Goal name</label>
            <input
              className="input"
              id="g-name"
              name="name"
              required
              maxLength={100}
              defaultValue={editing?.name ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="g-type">Type</label>
            <select
              className="select"
              id="g-type"
              name="type"
              defaultValue={editing?.type ?? 'savings'}
            >
              {['savings', 'emergency_fund', 'debt_reduction', 'custom'].map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="g-target">Target ({currency})</label>
            <input
              className="input"
              id="g-target"
              name="target"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={editing?.target?.amount ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="g-current">Progress ({currency})</label>
            <input
              className="input"
              id="g-current"
              name="current"
              type="number"
              step="0.01"
              required
              defaultValue={editing?.current?.amount ?? '0'}
            />
          </div>
          <div className="field">
            <label htmlFor="g-date">Target date</label>
            <input
              className="input"
              id="g-date"
              name="date"
              type="date"
              defaultValue={editing?.target_date ?? ''}
            />
          </div>
          <div className="od-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {editing ? 'Update goal' : 'Add goal'}
            </button>
            {editing && (
              <button className="btn" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </Card>
      <div className="grid-2">
        <Card title="Merchant rules">
          <p className="quiet">Apply a category consistently. Individual overrides always win.</p>
          {rules.map((r) => (
            <div className="row" key={r.id}>
              <span className="od-fill">
                <span className="row-title">
                  {r.field} {r.operator} “{r.pattern}”
                </span>
                <span className="row-sub">
                  → {categoryName({ categoriesCatalog: categories }, r.category_id)} · version{' '}
                  {r.version} · {r.active ? 'active' : 'paused'}
                </span>
              </span>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  mutate(
                    '/api/rules/' + r.id,
                    {
                      field: r.field,
                      operator: r.operator,
                      pattern: r.pattern,
                      category_id: r.category_id,
                      priority: r.priority,
                      active: !r.active,
                    },
                    'PUT',
                  )
                }
              >
                {r.active ? 'Pause' : 'Enable'}
              </button>
            </div>
          ))}
          <form
            className="form-grid"
            style={{ marginTop: 'var(--sp-4)' }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate(
                '/api/rules/' + crypto.randomUUID(),
                {
                  field: 'merchant',
                  operator: f.get('operator'),
                  pattern: f.get('pattern'),
                  category_id: f.get('category'),
                  priority: 100,
                  active: true,
                },
                'PUT',
              );
            }}
          >
            <div className="field">
              <label htmlFor="r-pattern">Merchant text</label>
              <input className="input" id="r-pattern" name="pattern" required maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="r-op">Match</label>
              <select className="select" id="r-op" name="operator">
                <option value="contains">Contains</option>
                <option value="equals">Equals</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="r-cat">Category</label>
              <select className="select" id="r-cat" name="category">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary"
              type="submit"
              style={{ alignSelf: 'end' }}
              disabled={busy}
            >
              Add rule
            </button>
          </form>
        </Card>
        <Card title="AI access">
          <p className="quiet">
            Connect an MCP client, then sign in with your owner account and review the requested
            permissions.
          </p>
          <div
            className="card card-flat"
            style={{ padding: 'var(--sp-3) var(--sp-4)', margin: 'var(--sp-3) 0' }}
          >
            <code>{mcpOrigin}/mcp</code> <span className="quiet">on this origin</span>
          </div>
          {grants.map((g) => (
            <div className="row" key={g.id}>
              <span className="od-fill">
                <span className="row-title">{g.clientId}</span>
                <span className="row-sub">
                  {(g.scope ?? []).join(', ')} · granted {fmtDateTime(g.created_at)}
                </span>
              </span>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => mutate('/api/oauth/grants/' + g.id + '/revoke', {})}
              >
                Revoke
              </button>
            </div>
          ))}
          {!grants.length && <p className="quiet">No client grants to display.</p>}
          <p className="quiet" style={{ marginTop: 'var(--sp-3)' }}>
            Calculations stay in this application. Data is shared only when an authorized client
            queries it.
          </p>
        </Card>
      </div>
      <Card title="Appearance">
        <div className="od-row" style={{ justifyContent: 'space-between' }}>
          <div className="od-stack" style={gap('2px')}>
            <span className="row-title">Dark theme</span>
            <span className="row-sub">Follows your system by default; toggle to override.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={dark} onChange={toggleTheme} aria-label="Dark theme" />
            <span className="switch-track">
              <span className="switch-thumb" />
            </span>
          </label>
        </div>
      </Card>
      <Card title="Session">
        <div className="od-row" style={{ justifyContent: 'space-between' }}>
          <div className="od-stack" style={gap('2px')}>
            <span className="row-title">Private workspace</span>
            <span className="row-sub">Sandbox banking · single owner</span>
          </div>
          <button className="btn btn-danger" onClick={logout} disabled={busy}>
            Sign out
          </button>
        </div>
      </Card>
    </div>
  );
}

function SetupPanel({
  data,
  demo,
  busy,
  refresh,
  connect,
}: {
  data: Any;
  demo: boolean;
  busy: boolean;
  categories: Any[];
  refresh: () => void;
  connect: () => void;
}) {
  const plaidReady = data.checks?.find((check: Any) => check.id === 'plaid')?.status === 'ready';
  const connectionReady =
    data.checks?.find((check: Any) => check.id === 'bank_connection')?.status === 'ready';
  return (
    <div className="content">
      <section className="card setup-intro">
        <p className="eyebrow">Private onboarding</p>
        <h2>
          {data.status === 'ready'
            ? 'Your workspace is ready.'
            : 'Finish setting up your workspace.'}
        </h2>
        <p>
          These checks run on the server and never reveal secret values. Once they pass, the first
          sync will import account history and queue the initial calculations.
        </p>
      </section>
      <section className="setup-grid" aria-label="Setup checks">
        {data.checks?.map((check: Any) => (
          <article className="card setup-check" key={check.id}>
            <div className="setup-check-head">
              <h2>{check.label}</h2>
              <span className={'pill ' + statusTone(check.status)}>{label(check.status)}</span>
            </div>
            <p>{check.detail}</p>
          </article>
        ))}
      </section>
      <section className="card setup-actions">
        <div>
          <h2>{connectionReady ? 'Keep your data current' : 'Connect your first institution'}</h2>
          <p className="quiet">
            {connectionReady
              ? 'You can review the connection or add another institution from Accounts.'
              : demo
                ? 'The synthetic preview does not connect to banks. Run the Worker locally to use Plaid Link.'
                : plaidReady
                  ? 'Plaid Link opens a secure read-only connection. Your access token stays encrypted on the Worker.'
                  : 'Configure Plaid credentials above, then return here to connect a bank.'}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={refresh} disabled={busy}>
            Refresh checks
          </button>
          {!demo && plaidReady && (
            <button className="btn btn-primary" onClick={connect} disabled={busy}>
              {connectionReady ? 'Add another institution' : 'Connect institution'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
