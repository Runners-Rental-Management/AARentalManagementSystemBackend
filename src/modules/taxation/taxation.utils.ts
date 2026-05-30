/** Average days per month (Ethiopian tax guidance uses calendar-year proration). */
export const AVG_DAYS_PER_MONTH = 30.44;

/** Proclamation 1320/2024: vacancy gaps at or above 180 days count as potential income. */
export const LONG_TERM_VACANCY_DAYS = 180;

export interface VacancyPeriod {
  startDate: Date;
  endDate: Date;
  daysVacant: number;
}

export function formatUserName(user: {
  firstName: string;
  lastName: string;
}): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function decimalToNumber(
  value: { toString(): string } | number | null | undefined,
): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

export function monthsActiveInYear(
  startDate: Date,
  endDate: Date,
  year: number,
): number {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  const periodStart = new Date(
    Math.max(startDate.getTime(), yearStart.getTime()),
  );
  const periodEnd = new Date(Math.min(endDate.getTime(), yearEnd.getTime()));
  if (periodStart > periodEnd) return 0;
  const msPerMonth = AVG_DAYS_PER_MONTH * 24 * 60 * 60 * 1000;
  return (periodEnd.getTime() - periodStart.getTime()) / msPerMonth;
}

export function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function contractOverlapsYear(
  startDate: Date,
  endDate: Date,
  year: number,
): boolean {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  return startDate <= yearEnd && endDate >= yearStart;
}

export function vacancyMonthsFromDays(vacancyDays: number): number {
  return vacancyDays / AVG_DAYS_PER_MONTH;
}

export function calculateEstimatedTax(
  totalTaxableIncome: number,
  taxRate: number,
): number {
  return Math.round(totalTaxableIncome * taxRate * 100) / 100;
}

export function percentageFromVacancy(
  actual: number,
  vacancy: number,
): number {
  const total = actual + vacancy;
  if (total <= 0) return 0;
  return Math.round((vacancy / total) * 10000) / 100;
}
