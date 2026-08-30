import React, { useState, useEffect, useMemo } from 'react';
import PresupuestoModal from './PresupuestoModal';
import MetaModal from './MetaModal';
import CostoFijoModal from './CostoFijoModal';
import { useFinance } from '../context/FinanceContext';
import { format, subMonths, addMonths, isSameMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatCurrency } from '../../../shared/utils/format';
import {
  Icon, Card, Pill, IconTile, IconBtn, ProgressBar, Eyebrow, SectionHeader,
} from '../../../shared/ds/Primitives';
import ContextSwitcher from './ContextSwitcher';

const HUE_CYCLE = ['clay', 'olive', 'amber', 'plum', 'ink'];

export default function Presupuestos({ onNavigate }) {
  const { budgets, fetchBudgetConfig, saveBudgetConfig, goals, fixedCosts, markFixedCostPaid, transactions, appConfig, currentContext } = useFinance();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isPresupuestoModalOpen, setIsPresupuestoModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [isMetaModalOpen, setIsMetaModalOpen] = useState(false);
  const [editingMeta, setEditingMeta] = useState(null);
  const [isCostoFijoModalOpen, setIsCostoFijoModalOpen] = useState(false);
  const [editingCostoFijo, setEditingCostoFijo] = useState(null);

  const monthStr     = format(currentDate, 'yyyy-MM');
  const monthDisplay = format(currentDate, 'MMMM yyyy', { locale: es });
  const contextoKey  = currentContext === 'business' ? 'business' : 'personal';
  const budgetId     = `${monthStr}_${contextoKey}`;

  useEffect(() => {
    fetchBudgetConfig(monthStr, contextoKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr, contextoKey]);

  const [localCategories, setLocalCategories] = useState([]);

  const monthTransactions = useMemo(() => {
    const [year, month] = monthStr.split('-').map(Number);
    return transactions.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });
  }, [transactions, monthStr]);

  const spendingMap = useMemo(() => {
    const map = {};
    const contextFiltered = monthTransactions.filter(t => {
      if (contextoKey === 'personal') return t.context === 'personal';
      if (contextoKey === 'business') return t.context === 'business';
      return true;
    });
    contextFiltered.forEach(t => {
      if (t.type === 'debit' && t.category) {
        const amount = Number(t.amount);
        map[`${t.category}-ALL`] = (map[`${t.category}-ALL`] || 0) + amount;
        if (t.subcategory) map[`${t.category}-${t.subcategory}`] = (map[`${t.category}-${t.subcategory}`] || 0) + amount;
      }
    });
    return map;
  }, [monthTransactions, contextoKey]);

  const getBudgetId = (cat) => `${cat.nombre}-${cat.subcategory || 'ALL'}`;

  const enrichedCategories = useMemo(() =>
    localCategories.map(cat => ({ ...cat, gastado: spendingMap[getBudgetId(cat)] || 0 })),
    [localCategories, spendingMap]);

  const gastadoReal = useMemo(() => enrichedCategories.reduce((a, c) => a + c.gastado, 0), [enrichedCategories]);

  useEffect(() => {
    if (budgets[budgetId]?.categories) setLocalCategories(budgets[budgetId].categories);
    else setLocalCategories([]);
  }, [budgets, budgetId]);

  const presupuestadoTotal = useMemo(() => enrichedCategories.reduce((a, c) => a + Number(c.limite), 0), [enrichedCategories]);

  // BUGFIX: antes filtraba por `t.account`, un campo que ninguna transacción
  // usa (las transacciones guardan la cuenta en `t.card`/`t.destinationCard`),
  // así que ninguna Meta mostraba nunca progreso. Además de ingresos directos
  // a la cuenta de la meta, cuenta también el dinero que llega por
  // Transferencia (ej. el aporte automático del Fondo de Seguridad).
  const goalSavings = useMemo(() => {
    const s = {};
    goals.forEach(g => {
      if (g.cuenta) {
        s[g.id] = transactions
          .filter(t =>
            (t.type === 'credit' && t.card === g.cuenta) ||
            (t.type === 'transfer' && t.destinationCard === g.cuenta)
          )
          .reduce((a, t) => a + Number(t.amount), 0);
      }
    });
    return s;
  }, [transactions, goals]);

  const localGoals = useMemo(() =>
    goals
      .filter(g => currentContext === 'unified' ? true : g.contexto === currentContext)
      .map(g => ({ ...g, ahorrado: goalSavings[g.id] || 0 })),
    [goals, currentContext, goalSavings]);

  // --- Costos Fijos ---
  // La app no sabe de antemano si un costo fijo ya se pagó — lo cruza cada
  // mes contra las transacciones reales de ese contexto, buscando el nombre
  // del costo fijo dentro del título o los comentarios del movimiento (ej.
  // "Netflix" adentro de "Netflix.com"). Si no aparece ningún movimiento que
  // coincida, sigue "Pendiente" (o "Atrasado" si ya pasó el día de vencimiento
  // y estamos viendo el mes real actual).
  const monthDebitsCtx = useMemo(() =>
    monthTransactions.filter(t =>
      t.type === 'debit' && !(t.type === 'transfer' || t.isTransfer) && t.context === contextoKey
    ),
    [monthTransactions, contextoKey]);

  const isCurrentRealMonth = useMemo(() => isSameMonth(currentDate, new Date()), [currentDate]);
  const todayDayOfMonth = new Date().getDate();

  const localFixedCosts = useMemo(() =>
    fixedCosts
      .filter(f => currentContext === 'unified' ? true : f.contexto === currentContext)
      .map(f => {
        const nombreLower = (f.nombre || '').trim().toLowerCase();
        const match = monthDebitsCtx.find(t =>
          (t.title || '').toLowerCase().includes(nombreLower) ||
          (t.comments || '').toLowerCase().includes(nombreLower)
        );
        // Red de seguridad: si el correo del banco no trae un título que
        // coincida (típico en servicios públicos, que varían de nombre mes a
        // mes), el usuario puede marcarlo pagado a mano para ese mes puntual.
        const pagadoManual = !match && !!(f.pagosManuales && f.pagosManuales[monthStr]);
        const pagado = !!match || pagadoManual;
        const atrasado = !pagado && isCurrentRealMonth && todayDayOfMonth > Number(f.diaVencimiento || 31);
        return {
          ...f,
          pagado,
          pagadoManual,
          atrasado,
          montoPagado: match ? Number(match.amount) : null,
          fechaPagado: match ? match.date : null,
        };
      })
      .sort((a, b) => Number(a.diaVencimiento || 31) - Number(b.diaVencimiento || 31)),
    [fixedCosts, currentContext, monthDebitsCtx, isCurrentRealMonth, todayDayOfMonth, monthStr]);

  const handleToggleManualPago = async (costo, e) => {
    e.stopPropagation();
    try {
      await markFixedCostPaid(costo.id, monthStr, !costo.pagadoManual);
    } catch (error) {
      console.error('Error al marcar costo fijo como pagado:', error);
    }
  };

  const catIconMap = useMemo(() => {
    const m = {};
    (appConfig?.categories || []).forEach(c => { m[c.name] = c.icon; });
    return m;
  }, [appConfig]);

  // Month tempo — how far through the month we are
  const tempo = useMemo(() => {
    const now = new Date();
    const y = currentDate.getFullYear(), m = currentDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const firstOfMonth = new Date(y, m, 1);
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const isCurrent = y === now.getFullYear() && m === now.getMonth();
    const isPast = firstOfMonth < firstOfThisMonth;
    const dayOfMonth = isCurrent ? now.getDate() : (isPast ? daysInMonth : 0);
    const daysRemaining = daysInMonth - dayOfMonth;
    const monthPct = daysInMonth ? dayOfMonth / daysInMonth : 0;
    return { daysInMonth, daysRemaining, monthPct };
  }, [currentDate]);

  const handleSaveBudgetConfig = async (categoryData, isEditing) => {
    let updated = [...localCategories];
    const newId = getBudgetId(categoryData);
    if (isEditing && editingCategory) {
      const origId = getBudgetId(editingCategory);
      updated = updated.map(c => getBudgetId(c) === origId ? categoryData : c);
    } else {
      if (updated.find(c => getBudgetId(c) === newId)) { alert("Este presupuesto ya existe."); return; }
      updated.push(categoryData);
    }
    await saveBudgetConfig(monthStr, contextoKey, updated);
  };

  const pct = (spent, limit) => Math.min(100, (spent / limit) * 100);

  // ── Unified view ─────────────────────────────────────────────────────
  const renderResumenGeneral = () => {
    const pBudget  = budgets[`${monthStr}_personal`]?.categories || [];
    const bBudget  = budgets[`${monthStr}_business`]?.categories || [];
    const pGastado = monthTransactions.filter(t => t.context === 'personal' && t.type === 'debit').reduce((a, t) => a + Number(t.amount), 0);
    const pTotal   = pBudget.reduce((a, c) => a + c.limite, 0);
    const bGastado = monthTransactions.filter(t => t.context === 'business' && t.type === 'debit').reduce((a, t) => a + Number(t.amount), 0);
    const bTotal   = bBudget.reduce((a, c) => a + c.limite, 0);
    const saludP   = pTotal > 0 ? (pGastado / pTotal) * 100 : 0;
    const saludB   = bTotal > 0 ? (bGastado / bTotal) * 100 : 0;

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        <Card moduleHue="var(--clay-500)" padding={20}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <Eyebrow>Salud personal</Eyebrow>
              <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--fg-1)', letterSpacing: '-0.02em', lineHeight: 1, marginTop: 8 }}>
                {saludP.toFixed(1)}<span style={{ fontSize: 20, color: 'var(--fg-3)' }}>%</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--fg-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Consumido este mes</p>
            </div>
            <IconTile icon="account_balance_wallet" hue="clay" size={40} />
          </div>
          <ProgressBar value={pGastado} max={pTotal || 1} color="var(--clay-500)" />
        </Card>

        <Card moduleHue="var(--plum-400)" padding={20}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <Eyebrow>Salud negocio</Eyebrow>
              <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--fg-1)', letterSpacing: '-0.02em', lineHeight: 1, marginTop: 8 }}>
                {saludB.toFixed(1)}<span style={{ fontSize: 20, color: 'var(--fg-3)' }}>%</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--fg-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Consumido este mes</p>
            </div>
            <IconTile icon="business_center" hue="plum" size={40} />
          </div>
          <ProgressBar value={bGastado} max={bTotal || 1} color="var(--plum-400)" />
        </Card>

        <Card variant="outlined" padding={20} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <IconTile icon="info" hue="ink" size={36} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>El contexto General no mezcla presupuestos.</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              Selecciona Personal o Negocio para gestionar categorías y límites.
            </div>
          </div>
        </Card>
      </div>
    );
  };

  // ── Personal / Business view ─────────────────────────────────────────
  const renderContextoEspecifico = () => {
    const disponible    = presupuestadoTotal - gastadoReal;
    const spendPct      = presupuestadoTotal > 0 ? gastadoReal / presupuestadoTotal : 0;
    const perDay        = tempo.daysRemaining > 0 ? Math.max(0, disponible) / tempo.daysRemaining : 0;
    const moduleColor   = currentContext === 'business' ? 'var(--plum-400)' : 'var(--clay-500)';

    const excedidas = enrichedCategories.filter(c => c.gastado > c.limite);
    const adelantadas = enrichedCategories.filter(c => c.gastado <= c.limite && (c.gastado / c.limite - tempo.monthPct) > 0.1);

    const callout = excedidas.length > 0
      ? { tone: 'danger', icon: 'warning', text: <><strong style={{ color: 'var(--danger-700)' }}>{excedidas.length === 1 ? `${excedidas[0].nombre} excedido.` : `${excedidas.length} categorías excedidas.`}</strong> Revisa los límites antes de fin de mes.</> }
      : adelantadas.length > 0
        ? { tone: 'warning', icon: 'trending_up', text: <><strong style={{ color: 'var(--warning-700)' }}>Vas adelantado.</strong> {adelantadas.length} {adelantadas.length === 1 ? 'categoría gasta' : 'categorías gastan'} más rápido que el ritmo del mes.</> }
        : { tone: 'success', icon: 'check_circle', text: <><strong style={{ color: 'var(--success-700)' }}>Vas en ritmo.</strong> Tu gasto sigue el paso del mes sin sobresaltos.</> };
    const calloutBg = { danger: 'var(--danger-50)', warning: 'var(--warning-50)', success: 'var(--success-50)' }[callout.tone];
    const calloutBar = { danger: 'var(--danger-500)', warning: 'var(--warning-500)', success: 'var(--success-500)' }[callout.tone];
    const calloutFg = { danger: 'var(--danger-700)', warning: 'var(--warning-700)', success: 'var(--success-700)' }[callout.tone];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Tempo card */}
        <Card padding={18} style={{ background: 'var(--ink-800)', color: '#fff', borderRadius: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <Eyebrow style={{ color: 'rgba(255,255,255,0.55)' }}>Quedan</Eyebrow>
              <div style={{ marginTop: 4, fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>
                {tempo.daysRemaining}
                <span style={{ fontSize: 15, opacity: 0.6, marginLeft: 6, fontWeight: 500 }}>días del mes</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Eyebrow style={{ color: 'rgba(255,255,255,0.55)' }}>Disponible</Eyebrow>
              <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: disponible < 0 ? 'var(--clay-300)' : '#fff', fontFamily: 'var(--font-mono)' }}>
                {formatCurrency(disponible, 'COP')}
              </div>
              {perDay > 0 && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                  {formatCurrency(Math.round(perDay), 'COP')}/día sugerido
                </div>
              )}
            </div>
          </div>
          {/* Month progress bar with spend marker */}
          <div style={{ marginTop: 14, position: 'relative' }}>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.12)' }} />
            <div style={{ position: 'absolute', top: 0, left: 0, height: 6, borderRadius: 999, background: '#fff', width: `${tempo.monthPct * 100}%` }} />
            <div style={{
              position: 'absolute', top: -3, left: `${Math.min(100, spendPct * 100)}%`,
              width: 4, height: 12, borderRadius: 2, background: moduleColor, transform: 'translateX(-2px)',
            }} />
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginTop: 8,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)',
            }}>
              <span>Inicio</span>
              <span style={{ color: 'var(--clay-300)' }}>Gastado {(spendPct * 100).toFixed(0)}%</span>
              <span>Fin de mes</span>
            </div>
          </div>
        </Card>

        {/* Insight callout */}
        {enrichedCategories.length > 0 && (
          <Card padding={14} style={{ background: calloutBg, borderLeft: `4px solid ${calloutBar}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Icon name={callout.icon} size={20} color={calloutFg} />
              <div style={{ fontSize: 12.5, color: 'var(--ink-600)', lineHeight: 1.45 }}>{callout.text}</div>
            </div>
          </Card>
        )}

        <div className="grid gap-3.5 md:grid-cols-2 md:items-start" style={{ display: 'grid' }}>
          {/* Categories — bars with tempo marker */}
          <Card padding={16}>
            <div style={{ marginBottom: 12 }}>
              <SectionHeader
                title="Por categoría" eyebrow="Ritmo vs. mes"
                action="Agregar"
                onAction={() => { setEditingCategory(null); setIsPresupuestoModalOpen(true); }}
              />
            </div>

            {enrichedCategories.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--fg-3)' }}>
                <IconTile icon="savings" hue="ink" size={48} />
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--fg-2)' }}>No hay presupuesto configurado para este mes.</div>
              </div>
            ) : (
              <div>
                {enrichedCategories.map((cat, i) => {
                  const ratio = cat.limite > 0 ? cat.gastado / cat.limite : 0;
                  const excedido = cat.gastado > cat.limite;
                  const warn = !excedido && ratio >= 0.9;
                  const tempoDelta = ratio - tempo.monthPct;
                  const displayName = cat.subcategory ? `${cat.nombre} › ${cat.subcategory}` : cat.nombre;
                  const barColor = excedido ? 'var(--danger-500)' : warn ? 'var(--amber-300)' : moduleColor;
                  return (
                    <div
                      key={i}
                      onClick={() => onNavigate && onNavigate('categoria', { category: cat.nombre })}
                      style={{
                        padding: '12px 0', cursor: 'pointer',
                        borderBottom: i < enrichedCategories.length - 1 ? '1px solid var(--border-default)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <IconTile icon={catIconMap[cat.nombre] || 'category'} hue={HUE_CYCLE[i % HUE_CYCLE.length]} size={34} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(cat.gastado, 'COP')} de {formatCurrency(cat.limite, 'COP')}
                          </div>
                        </div>
                        {excedido ? <Pill variant="danger" icon="warning">Excedido</Pill>
                          : tempoDelta > 0.1 ? <Pill variant="warning" icon="trending_up">Adelantado</Pill>
                          : tempoDelta < -0.15 ? <Pill variant="success">Holgado</Pill>
                          : <Pill variant="neutral">En ritmo</Pill>}
                        <IconBtn
                          icon="tune" tone="sunken" size={30}
                          title="Editar presupuesto"
                          onClick={(e) => { e.stopPropagation(); setEditingCategory(localCategories[i]); setIsPresupuestoModalOpen(true); }}
                        />
                      </div>
                      {/* Bar with tempo marker */}
                      <div style={{ position: 'relative' }}>
                        <div style={{ height: 8, background: 'var(--parchment-200)', borderRadius: 999 }} />
                        <div style={{
                          position: 'absolute', top: 0, left: 0, height: 8, borderRadius: 999,
                          background: barColor, width: `${Math.min(100, ratio * 100)}%`,
                          transition: 'width var(--dur-slow) var(--ease-out)',
                        }} />
                        <div
                          title="Ritmo del mes"
                          style={{
                            position: 'absolute', top: -2, left: `${tempo.monthPct * 100}%`,
                            width: 2, height: 12, background: 'var(--ink-700)', transform: 'translateX(-1px)',
                          }}
                        />
                      </div>
                      {excedido && (
                        <p style={{ margin: '6px 0 0', fontSize: 10, fontWeight: 700, color: 'var(--danger-700)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="error" size={12} /> Te pasaste por {formatCurrency(cat.gastado - cat.limite, 'COP')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Savings goals */}
          <Card padding={16}>
            <div style={{ marginBottom: 12 }}>
              <SectionHeader
                title="Metas de ahorro" eyebrow={`${localGoals.length} ${localGoals.length === 1 ? 'meta' : 'metas'}`}
                action="Nueva"
                onAction={() => { setEditingMeta(null); setIsMetaModalOpen(true); }}
              />
            </div>

            {localGoals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--fg-3)' }}>
                <IconTile icon="savings" hue="olive" size={48} />
                <div style={{ marginTop: 10, fontSize: 13, color: 'var(--fg-2)' }}>No hay metas configuradas.</div>
              </div>
            ) : (
              <div>
                {localGoals.map((meta, i) => {
                  const progreso = pct(meta.ahorrado, meta.objetivo);
                  return (
                    <div
                      key={meta.id}
                      onClick={() => { setEditingMeta(meta); setIsMetaModalOpen(true); }}
                      style={{
                        padding: '12px 0', cursor: 'pointer',
                        borderBottom: i < localGoals.length - 1 ? '1px solid var(--border-default)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg-1)' }}>{meta.nombre}</div>
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
                            {formatCurrency(meta.ahorrado, 'COP')} de {formatCurrency(meta.objetivo, 'COP')}
                          </div>
                        </div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: 'var(--olive-600)' }}>
                          {progreso.toFixed(0)}%
                        </span>
                      </div>
                      <ProgressBar value={meta.ahorrado} max={meta.objetivo || 1} color="var(--olive-500)" />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Costos fijos — checklist mensual */}
        <Card padding={16}>
          <div style={{ marginBottom: 12 }}>
            <SectionHeader
              title="Costos fijos" eyebrow={`${localFixedCosts.length} ${localFixedCosts.length === 1 ? 'costo' : 'costos'}`}
              action="Agregar"
              onAction={() => { setEditingCostoFijo(null); setIsCostoFijoModalOpen(true); }}
            />
          </div>

          {localFixedCosts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--fg-3)' }}>
              <IconTile icon="event_repeat" hue="clay" size={48} />
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--fg-2)' }}>No hay costos fijos configurados.</div>
            </div>
          ) : (
            <div>
              {localFixedCosts.map((costo, i) => {
                const detectadoAuto = costo.montoPagado != null;
                return (
                <div
                  key={costo.id}
                  onClick={() => { setEditingCostoFijo(costo); setIsCostoFijoModalOpen(true); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    padding: '12px 0', cursor: 'pointer',
                    borderBottom: i < localFixedCosts.length - 1 ? '1px solid var(--border-default)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    <IconBtn
                      icon={costo.pagado ? 'check_circle' : 'radio_button_unchecked'}
                      fill={costo.pagado}
                      tone="sunken"
                      size={30}
                      title={
                        detectadoAuto ? 'Detectado automáticamente en tus movimientos'
                          : costo.pagadoManual ? 'Marcado a mano — toca para quitar la marca'
                            : 'Marcar como pagado a mano'
                      }
                      onClick={detectadoAuto ? undefined : (e) => handleToggleManualPago(costo, e)}
                      style={costo.pagado
                        ? { background: 'var(--success-50)', color: 'var(--success-700)', cursor: detectadoAuto ? 'default' : 'pointer' }
                        : undefined}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg-1)' }}>{costo.nombre}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
                        {detectadoAuto
                          ? `Pagado ${formatCurrency(costo.montoPagado, 'COP')}`
                          : costo.pagadoManual
                            ? 'Marcado como pagado a mano'
                            : `Vence el ${costo.diaVencimiento} · esperado ${formatCurrency(costo.monto, 'COP')}`}
                      </div>
                    </div>
                  </div>
                  {detectadoAuto
                    ? <Pill variant="success" icon="check_circle">Pagado</Pill>
                    : costo.pagadoManual
                      ? <Pill variant="success" icon="check_circle">Pagado (manual)</Pill>
                      : costo.atrasado
                        ? <Pill variant="danger" icon="warning">Atrasado</Pill>
                        : <Pill variant="neutral">Pendiente</Pill>}
                </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  };

  return (
    <>
      <ContextSwitcher />
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 16px 32px' }} className="animate-fade-up">

      {/* Page header with month nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}>Presupuestos</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--fg-3)' }}>Límites mensuales y ritmo de gasto.</p>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          background: 'var(--bg-raised)', border: '1px solid var(--border-default)',
          borderRadius: 12, padding: '6px 8px', boxShadow: 'var(--shadow-xs)',
        }}>
          <button type="button" onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--fg-3)', display: 'flex', padding: 2 }}>
            <Icon name="chevron_left" size={18} />
          </button>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--fg-1)', width: 96, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {monthDisplay}
          </span>
          <button type="button" onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--fg-3)', display: 'flex', padding: 2 }}>
            <Icon name="chevron_right" size={18} />
          </button>
        </div>
      </div>

      {currentContext === 'unified' ? renderResumenGeneral() : renderContextoEspecifico()}

      <PresupuestoModal
        isOpen={isPresupuestoModalOpen}
        onClose={() => { setIsPresupuestoModalOpen(false); setEditingCategory(null); }}
        currentContext={contextoKey}
        currentMonthStr={monthDisplay}
        editingCategory={editingCategory}
        onSaveConfig={handleSaveBudgetConfig}
      />
      <MetaModal
        isOpen={isMetaModalOpen}
        onClose={() => { setIsMetaModalOpen(false); setEditingMeta(null); }}
        currentContext={currentContext}
        editingMeta={editingMeta}
      />
      <CostoFijoModal
        isOpen={isCostoFijoModalOpen}
        onClose={() => { setIsCostoFijoModalOpen(false); setEditingCostoFijo(null); }}
        currentContext={currentContext}
        editingCostoFijo={editingCostoFijo}
      />
    </div>
    </>
  );
}
