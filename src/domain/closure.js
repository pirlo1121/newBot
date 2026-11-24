import { categoryLabel } from './categories.js';
import { periodLabel } from './dates.js';
import { formatCop } from './money.js';

/** Porcentaje con un decimal, sin flotantes en el dinero: 1/3 → 33.3. */
export function percentOf(part, total) {
  if (!total) return 0;
  return Math.round((part * 1000) / total) / 10;
}

export const formatPercent = (value) => `${String(value).replace('.', ',')} %`;

/**
 * Ordena categorías por total descendente y nombre ascendente (RN-15).
 * Devuelve la mayor y la menor; con una sola categoría la menor es null.
 */
export function rankCategories(categoryTotals) {
  const ranked = categoryTotals
    .filter((item) => item.total_cents > 0)
    .sort((a, b) => b.total_cents - a.total_cents || a.category.localeCompare(b.category));
  return {
    ranked,
    top: ranked[0]?.category ?? null,
    bottom: ranked.length > 1 ? ranked.at(-1).category : null
  };
}

/**
 * Cálculo puro del cierre (RN-13, RN-14). Todo en centavos enteros.
 */
export function computeClosure({ salaryCents, extraIncomeCents, fixedPaidCents, categoryTotals }) {
  const { ranked, top, bottom } = rankCategories(categoryTotals);
  const extraExpenseCents = ranked.reduce((sum, item) => sum + item.total_cents, 0);
  const balanceCents = salaryCents + extraIncomeCents - fixedPaidCents - extraExpenseCents;

  return {
    salaryCents,
    extraIncomeCents,
    fixedPaidCents,
    extraExpenseCents,
    balanceCents,
    savedCents: Math.max(balanceCents, 0),
    deficitCents: balanceCents < 0 ? -balanceCents : 0,
    topCategory: top,
    bottomCategory: bottom,
    breakdown: ranked.map((item) => ({
      category: item.category,
      total_cents: item.total_cents,
      percent: percentOf(item.total_cents, extraExpenseCents)
    }))
  };
}

/** Texto del reporte de cierre (§8.7) que el bot envía tal cual. */
export function closureReportText({ period, closure, savingsBalanceCents, salaryMissing }) {
  const lines = [`📊 Cierre de ${periodLabel(period)}`, ''];
  const income = closure.salaryCents + closure.extraIncomeCents;

  lines.push(
    `Ingresos: ${formatCop(income)} (salario ${formatCop(closure.salaryCents)} + extras ${formatCop(closure.extraIncomeCents)})`
  );
  if (salaryMissing) lines.push('⚠️ No había salario configurado para este mes.');
  lines.push(`Gastos fijos pagados: ${formatCop(closure.fixedPaidCents)}`);
  lines.push(`Gastos extras: ${formatCop(closure.extraExpenseCents)}`);

  for (const item of closure.breakdown) {
    lines.push(
      `  • ${categoryLabel(item.category)}: ${formatCop(item.total_cents)} (${formatPercent(item.percent)})`
    );
  }

  if (closure.topCategory) {
    lines.push('');
    lines.push(`Mayor gasto: ${categoryLabel(closure.topCategory)}`);
    if (closure.bottomCategory) lines.push(`Menor gasto: ${categoryLabel(closure.bottomCategory)}`);
  }

  lines.push('');
  if (closure.deficitCents > 0) {
    lines.push(`Déficit del mes: ${formatCop(closure.deficitCents)} (no se descontó del ahorro).`);
  } else {
    lines.push(`Ahorro del mes: ${formatCop(closure.savedCents)}`);
  }
  lines.push(`Ahorro acumulado: ${formatCop(savingsBalanceCents)}`);

  return lines.join('\n');
}
