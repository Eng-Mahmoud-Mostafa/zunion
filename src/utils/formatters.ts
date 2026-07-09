export function formatNumber(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("ar-EG").format(Number.isFinite(number) ? number : 0);
}

export function formatMoney(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("ar-EG", {
    maximumFractionDigits: 1,
  }).format(Number.isFinite(number) ? number : 0);
}

export function formatDateArabic(date: string | null | undefined) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return String(date);
  return new Intl.DateTimeFormat("ar-EG", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}
