export function normalizeDigitsToEnglish(value: unknown) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

export function formatNumber(value: unknown) {
  const number = Number(value ?? 0);
  return normalizeDigitsToEnglish(new Intl.NumberFormat("en-US").format(Number.isFinite(number) ? number : 0));
}

export function formatMoney(value: unknown) {
  const number = Number(value ?? 0);
  return normalizeDigitsToEnglish(new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(Number.isFinite(number) ? number : 0));
}

export function formatDateArabic(date: string | null | undefined) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return normalizeDigitsToEnglish(date);
  return normalizeDigitsToEnglish(new Intl.DateTimeFormat("en-GB", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed));
}

export function formatDateTimeEnglish(date: string | number | Date | null | undefined) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return normalizeDigitsToEnglish(date);
  return normalizeDigitsToEnglish(new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed));
}
