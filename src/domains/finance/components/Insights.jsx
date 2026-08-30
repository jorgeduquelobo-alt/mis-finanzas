import React, { useMemo } from 'react';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency, formatCompactNumber } from '../../../shared/utils/format';
import {
  Icon, Card, Pill, Eyebrow, Editorial, SectionHeader, BarChart,
  hueForCategory, hueColorVar,
} from '../../../shared/ds/Primitives';
import ContextSwitcher from './ContextSwitcher';
import CompactTransactions from './CompactTransactions';

const DEFAULT_EXCHANGE_RATE = 4100;
const DAY_MS = 86400000;

const isTransferTx = (t) => t.type === 'transfer' || t.isTransfer === true;
const toCOP = (t, rate) => (t.currency === 'USD' ? t.amount * rate : t.amount);
const txDate = (t) => (t.date?.toDate ? t.date.toDate() : new Date(t.date));
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export default function Insights({ onNavigate, onEditTransaction }) {
  const { transactions, loading, currentContext, appConfig } = useFinance();

  // Tasa USD→COP configurable en Settings → Finanzas; fallback al valor histórico.
  const exchangeRate = Number(appConfig?.exchangeRate) > 0
    ? Number(appConfig.exchangeRate)
    : DEFAULT_EXCHANGE_RATE;

  const filtered = useMemo(() => (
    transactions.filter(t => {
      if (currentContext === 'unified') return true;
      if (isTransferTx(t)) return t.context === currentContext || t.destinationContext === currentContext;
      return t.context === currentContext;
    })
  ), [transactions, currentContext]);

  const today = useMemo(() => new Date(), []);
  const month = today.getMonth();
  const year = today.getFullYear();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevMonthYear = month === 0 ? year - 1 : year;

  // 30-day daily spending series (expenses only)
  const daily = useMemo(() => {
    const arr = new Array(30).fill(0);
    const start = midnight(today);
    start.setDate(start.getDate() - 29);
    filtered.forEach(t => {
      if (t.type !== 'debit' || isTransferTx(t)) return;
      const idx = Math.floor((midnight(txDate(t)) - start) / DAY_MS);
      if (idx >= 0 && idx < 30) arr[idx] += toCOP(t, exchangeRate);
    });
    return arr;
  }, [filtered, today, exchangeRate]);

  const todayTotal = daily[29];
  const todayCount = useMemo(() => (
    filtered.filter(t => t.type === 'debit' && !isTransferTx(t) &&
      midnight(txDate(t)).getTime() === midnight(today).getTime()).length
  ), [filtered, today]);
  const dailyAvg = daily.reduce((a, b) => a + b, 0) / 30;
  const last7 = daily.slice(-7);

  // Month aggregates
  const monthAgg = useMemo(() => {
    const inMonth = (d) => d.getMonth() === month && d.getFullYear() === year;
    const inPrev = (d) => d.getMonth() === prevMonth && d.getFullYear() === prevMonthYear;
    let spent = 0, income = 0, prevSpent = 0, prevIncome = 0;
    filtered.forEach(t => {
      if (isTransferTx(t)) return;
      const d = txDate(t), amt = toCOP(t, exchangeRate);
      if (inMonth(d)) {
        if (t.type === 'debit') spent += amt;
        if (t.type === 'credit') income += amt;
      } else if (inPrev(d)) {
        if (t.type === 'debit') prevSpent += amt;
        if (t.type === 'credit') prevIncome += amt;
      }
    });
    const savings = income > 0 ? ((income - spent) / income) * 100 : 0;
    const prevSavings = prevIncome > 0 ? ((prevIncome - prevSpent) / prevIncome) * 100 : 0;
    return {
      spent, income, savings, prevSavings,
      spentDelta: prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : 0,
      incomeDelta: prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : 0,
    };
  }, [filtered, month, year, prevMonth, prevMonthYear, exchangeRate]);

  // Registration streak (consecutive days with at least one transaction)
  const streak = useMemo(() => {
    const days = new Set(filtered.map(t => midnight(txDate(t)).getTime()));
    let count = 0;
    const cursor = midnight(today);
    if (!days.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);
    while (days.has(cursor.getTime())) { count++; cursor.setDate(cursor.getDate() - 1); }
    return count;
  }, [filtered, today]);

  // Smart insights derived from real data
  const insights = useMemo(() => {
    const list = [];
    const monthTxs = filtered.filter(t => {
      const d = txDate(t);
      return d.getMonth() === month && d.getFullYear() === year && t.type === 'debit' && !isTransferTx(t);
    });

    // Top expense category this month
    const cats = {};
    monthTxs.forEach(t => { const c = t.category || 'general'; cats[c] = (cats[c] || 0) + toCOP(t, exchangeRate); });
    const topCat = Object.entries(cats).sort(([, a], [, b]) => b - a)[0];
    if (topCat && monthAgg.spent > 0) {
      list.push({
        tone: 'var(--clay-500)', icon: 'local_fire_department', fill: true,
        titleColor: 'var(--clay-700)',
        title: `Tu mayor gasto va para ${topCat[0]}`,
        body: `${Math.round((topCat[1] / monthAgg.spent) * 100)}% del mes — ${formatCurrency(topCat[1], 'COP')}.`,
        onClick: () => onNavigate && onNavigate('categoria', { category: topCat[0] }),
      });
    }

    // Savings vs last month
    if (monthAgg.income > 0) {
      const up = monthAgg.savings >= monthAgg.prevSavings;
      list.push({
        tone: up ? 'var(--olive-500)' : 'var(--amber-300)',
        icon: up ? 'trending_up' : 'trending_down',
        titleColor: up ? 'var(--olive-600)' : 'var(--ink-700)',
        title: up ? 'Vas ahorrando bien este mes' : 'Tu ahorro bajó frente al mes pasado',
        body: `Tasa de ahorro ${monthAgg.savings.toFixed(0)}% · mes anterior ${monthAgg.prevSavings.toFixed(0)}%.`,
      });
    }

    // Biggest single expense in last 30 days
    const recent = filtered.filter(t => {
      if (t.type !== 'debit' || isTransferTx(t)) return false;
      return (midnight(today) - midnight(txDate(t))) / DAY_MS < 30;
    });
    const biggest = recent.sort((a, b) => toCOP(b, exchangeRate) - toCOP(a, exchangeRate))[0];
    if (biggest) {
      list.push({
        tone: 'var(--amber-300)', icon: 'schedule', titleColor: 'var(--ink-700)',
        title: `Tu mayor fuga: ${biggest.title}`,
        body: `${formatCurrency(toCOP(biggest, exchangeRate), 'COP')} · ${txDate(biggest).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}.`,
      });
    }
    return list;
  }, [filtered, month, year, monthAgg, today, onNavigate, exchangeRate]);

  // This-month spending grouped by category — entry point to the category heatmap
  const categoryBreakdown = useMemo(() => {
    const cats = {};
    filtered.forEach(t => {
      if (t.type !== 'debit' || isTransferTx(t)) return;
      const d = txDate(t);
      if (d.getMonth() !== month || d.getFullYear() !== year) return;
      const name = t.category || 'General';
      cats[name] = (cats[name] || 0) + toCOP(t, exchangeRate);
    });
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    return Object.entries(cats)
      .sort(([, a], [, b]) => b - a)
      .map(([name, amount]) => ({ name, amount, pct: total > 0 ? (amount / total) * 100 : 0 }));
  }, [filtered, month, year, exchangeRate]);

  const labels7 = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      out.push(['D', 'L', 'M', 'M', 'J', 'V', 'S'][d.getDay()]);
    }
    return out;
  }, [today]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--fg-3)' }}>
        <Icon name="autorenew" size={24} style={{ animation: 'spin 1s linear infinite', marginRight: 10 }} />
        Cargando…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const week7Total = last7.reduce((a, b) => a + b, 0);
  const monthLabel = today.toLocaleDateString('es-CO', { month: 'long' });

  return (
    <>
      <ContextSwitcher />
    <div
      className="animate-fade-up"
      style={{ maxWidth: 1000, margin: '0 auto', padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {/* Greeting */}
      <div>
        <Eyebrow style={{ marginBottom: 6 }}>
          {today.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Eyebrow>
        <Editorial size={26}>
          {streak > 0
            ? <>Llevas <span style={{ color: 'var(--clay-500)' }}>{streak} {streak === 1 ? 'día' : 'días'}</span> registrando.</>
            : <>Tu <span style={{ color: 'var(--clay-500)' }}>radiografía</span> financiera.</>}
        </Editorial>
      </div>

      {/* Hero — daily pulse */}
      <Card padding={20} style={{ background: 'var(--ink-800)', color: '#fff', borderRadius: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Eyebrow style={{ color: 'rgba(255,255,255,0.55)' }}>
            Gastado hoy · {today.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
          </Eyebrow>
          <Pill variant="clay" icon="bolt">En vivo</Pill>
        </div>
        <div style={{ marginTop: 10, fontSize: 38, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {todayTotal > 0 ? '−' : ''}{formatCurrency(todayTotal, 'COP')}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
          {todayCount} {todayCount === 1 ? 'movimiento' : 'movimientos'} · promedio diario {formatCurrency(Math.round(dailyAvg), 'COP')}
        </div>

        {/* 30-day pulse bars */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 64 }}>
            {daily.map((v, i) => {
              const max = Math.max(...daily, 1);
              const h = Math.max(2, (v / max) * 64);
              const isToday = i === 29;
              const dow = new Date(today.getTime() - (29 - i) * DAY_MS).getDay();
              const weekend = dow === 0 || dow === 6;
              return (
                <div key={i} style={{
                  flex: 1, height: h, borderRadius: 2,
                  background: isToday ? 'var(--clay-500)'
                    : weekend ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.14)',
                }} />
              );
            })}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginTop: 6,
            fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            <span>Hace 30 días</span>
            <span>Hoy</span>
          </div>
        </div>
      </Card>

      {/* Recent movements — compact mobile list */}
      <CompactTransactions onEditTransaction={onEditTransaction} />

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'Mes', value: `$ ${formatCompactNumber(monthAgg.spent)}`, delta: monthAgg.spentDelta, invert: true },
          { label: 'Ingresos', value: `$ ${formatCompactNumber(monthAgg.income)}`, delta: monthAgg.incomeDelta, invert: false },
          { label: 'Ahorro', value: `${monthAgg.savings.toFixed(0)}%`, delta: monthAgg.savings - monthAgg.prevSavings, invert: false, pp: true },
        ].map(s => {
          const good = s.invert ? s.delta <= 0 : s.delta >= 0;
          return (
            <Card key={s.label} padding={12}>
              <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--fg-3)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                {s.label}
              </div>
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 800, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}>
                {s.value}
              </div>
              <div style={{ fontSize: 10, color: good ? 'var(--olive-600)' : 'var(--danger-700)', fontWeight: 700, marginTop: 2 }}>
                {s.delta >= 0 ? '↑' : '↓'} {Math.abs(s.delta).toFixed(0)}{s.pp ? 'pp' : '%'}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Lower section — insights + weekly pulse */}
      <div className="grid gap-3 md:grid-cols-2 md:items-start" style={{ display: 'grid' }}>
        {/* Smart insights */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader title="Te conviene saber" eyebrow="Detectado por Mis Finanzas" />
          {insights.length === 0 ? (
            <Card padding={16}>
              <div style={{ fontSize: 13, color: 'var(--fg-3)', textAlign: 'center' }}>
                Registra movimientos para ver tu análisis.
              </div>
            </Card>
          ) : insights.map((ins, i) => (
            <Card
              key={i} padding={14}
              onClick={ins.onClick}
              style={{ borderLeft: `4px solid ${ins.tone}` }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Icon name={ins.icon} size={22} fill={ins.fill} color={ins.tone} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: ins.titleColor }}>{ins.title}</div>
                  <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-600)', lineHeight: 1.5 }}>{ins.body}</div>
                </div>
                {ins.onClick ? <Icon name="chevron_right" size={18} color="var(--fg-3)" /> : null}
              </div>
            </Card>
          ))}
        </div>

        {/* Weekly pulse */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader title="Pulso semanal" eyebrow="Últimos 7 días" />
          <Card padding={16}>
            <BarChart data={last7} height={84} color="var(--clay-500)" highlightIdx={6} labels={labels7} />
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginTop: 14,
              paddingTop: 12, borderTop: '1px dashed var(--border-default)',
            }}>
              <div>
                <Eyebrow>Total semana</Eyebrow>
                <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--fg-1)' }}>
                  −{formatCurrency(week7Total, 'COP')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Eyebrow>Promedio diario</Eyebrow>
                <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, color: 'var(--fg-1)' }}>
                  −{formatCurrency(Math.round(week7Total / 7), 'COP')}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Por categoría — tap a row to open the category heatmap */}
      {categoryBreakdown.length > 0 && (
        <div>
          <SectionHeader title="Por categoría" eyebrow={`${monthLabel} · toca para ver el detalle`} />
          <Card padding={6} style={{ marginTop: 10 }}>
            {categoryBreakdown.map(c => (
              <button
                key={c.name}
                type="button"
                onClick={() => onNavigate && onNavigate('categoria', { category: c.name })}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 10px', background: 'transparent', border: 'none',
                  cursor: 'pointer', textAlign: 'left', borderRadius: 12,
                  transition: 'background var(--dur-fast) var(--ease-out)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ink-50)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, background: hueColorVar(hueForCategory(c.name)), flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{c.pct.toFixed(0)}%</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--fg-1)' }}>
                  {formatCurrency(c.amount, 'COP')}
                </span>
                <Icon name="chevron_right" size={16} color="var(--fg-3)" />
              </button>
            ))}
          </Card>
        </div>
      )}
    </div>
    </>
  );
}
