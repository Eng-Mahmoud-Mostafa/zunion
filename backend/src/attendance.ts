import type { PoolClient } from "pg";

/**
 * Attendance import from a fingerprint-machine export (الحضور والانصراف).
 *
 * The device exports a raw punch log — one row per fingerprint punch — with the
 * columns (Arabic headers): رقم البصمه (device/employee code), الإسم (name),
 * الميعاد (timestamp "dd/MM/yyyy hh:mm ص|م"), نوع الحركه (حضور/إنصراف),
 * الحركه المعدله (overtime start/end), الإستثناءات (Invalid/FOT/Repeat).
 *
 * We store the raw punches and derive worked days/hours by aggregation, so the
 * import is fully idempotent (re-importing the same sheet inserts no new punch),
 * preserves earlier months, and never fabricates attendance before an employee
 * first appears. Employees are auto-created: matched by device code when present,
 * otherwise by a normalized name; a new code always becomes a separate employee
 * even if another employee has the same name; a name with no code that matches
 * more than one existing employee is flagged ambiguous rather than merged.
 */

export type AttendanceRawRow = {
  code?: string;
  name?: string;
  datetime?: string;
  movement?: string;
  adjusted?: string;
  exception?: string;
};

export type ParsedPunch = {
  code: string;
  name: string;
  normalized: string;
  punched_at: string; // "YYYY-MM-DD HH:mm:ss" (wall clock, no timezone shift)
  work_date: string;  // "YYYY-MM-DD"
  work_month: string; // "YYYY-MM"
  movement: string;
  adjusted: string;
  exception: string;
};

export type ExistingEmployee = { id: string; code: string | null; name: string; normalized_name: string };

export type EmployeePlan = {
  key: string;
  code: string | null;
  name: string;
  normalized: string;
  status: "new" | "existing" | "ambiguous";
  existingId?: string;
  candidateIds?: string[];
  punchCount: number;
  firstSeen: string;
};

export type InvalidRow = { index: number; reason: string; code: string; name: string; datetime: string };

/** Normalize an Arabic/Latin name for matching: strip diacritics, unify letter forms, collapse spaces. */
export function normalizeName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[ً-ٰٟـ]/g, "") // harakat + superscript alef + tatweel
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Parse "dd/MM/yyyy hh:mm[:ss] ص|م|AM|PM" into wall-clock date/time parts. */
export function parsePunchDate(raw: unknown): { punched_at: string; work_date: string; work_month: string } | null {
  const s = String(raw ?? "").trim();
  // Accepts proper Arabic ص/م and their CP1256-misread forms Õ/ã, and AM/PM.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|Õ|ã|am|pm)?/i);
  if (!m) return null;
  const [, dd, MM, yyyy, hh, mm, ss, ap] = m;
  const day = Number(dd);
  const month = Number(MM);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hour = Number(hh);
  if (hour > 23) return null;
  const marker = ap || "";
  const isPM = marker === "م" || marker === "ã" || /pm/i.test(marker);
  const isAM = marker === "ص" || marker === "Õ" || /am/i.test(marker);
  if (isPM && hour < 12) hour += 12;
  if (isAM && hour === 12) hour = 0;
  const pad = (n: number | string) => String(n).padStart(2, "0");
  const date = `${yyyy}-${pad(month)}-${pad(day)}`;
  const time = `${pad(hour)}:${mm}:${ss ? pad(ss) : "00"}`;
  return { punched_at: `${date} ${time}`, work_date: date, work_month: `${yyyy}-${pad(month)}` };
}

/** Split raw rows into valid parsed punches and a list of invalid rows with reasons. */
export function parseRows(rows: AttendanceRawRow[]): { punches: ParsedPunch[]; invalid: InvalidRow[] } {
  const punches: ParsedPunch[] = [];
  const invalid: InvalidRow[] = [];
  rows.forEach((row, index) => {
    const code = String(row.code ?? "").trim();
    const name = String(row.name ?? "").trim();
    const datetime = String(row.datetime ?? "").trim();
    if (!code && !name) {
      invalid.push({ index, reason: "لا يوجد كود موظف أو اسم", code, name, datetime });
      return;
    }
    const parsed = parsePunchDate(datetime);
    if (!parsed) {
      invalid.push({ index, reason: "تاريخ/وقت غير صالح", code, name, datetime });
      return;
    }
    punches.push({
      code,
      name,
      normalized: normalizeName(name),
      ...parsed,
      movement: String(row.movement ?? "").trim(),
      adjusted: String(row.adjusted ?? "").trim(),
      exception: String(row.exception ?? "").trim(),
    });
  });
  return { punches, invalid };
}

const punchKey = (p: ParsedPunch) => (p.code ? `code:${p.code}` : `name:${p.normalized}`);

/** Decide, for every employee the sheet references, whether they are new, existing or ambiguous. */
export function planEmployees(punches: ParsedPunch[], existing: ExistingEmployee[]): EmployeePlan[] {
  const byCode = new Map<string, ExistingEmployee>();
  const byNorm = new Map<string, ExistingEmployee[]>();
  for (const e of existing) {
    if (e.code) byCode.set(e.code, e);
    const list = byNorm.get(e.normalized_name) ?? [];
    list.push(e);
    byNorm.set(e.normalized_name, list);
  }
  const plans = new Map<string, EmployeePlan>();
  for (const p of punches) {
    const key = punchKey(p);
    let plan = plans.get(key);
    if (!plan) {
      if (p.code) {
        const ex = byCode.get(p.code);
        plan = { key, code: p.code, name: p.name, normalized: p.normalized, status: ex ? "existing" : "new", existingId: ex?.id, punchCount: 0, firstSeen: p.work_date };
      } else {
        const matches = byNorm.get(p.normalized) ?? [];
        if (matches.length === 1) plan = { key, code: null, name: p.name, normalized: p.normalized, status: "existing", existingId: matches[0].id, punchCount: 0, firstSeen: p.work_date };
        else if (matches.length > 1) plan = { key, code: null, name: p.name, normalized: p.normalized, status: "ambiguous", candidateIds: matches.map((m) => m.id), punchCount: 0, firstSeen: p.work_date };
        else plan = { key, code: null, name: p.name, normalized: p.normalized, status: "new", punchCount: 0, firstSeen: p.work_date };
      }
      plans.set(key, plan);
    }
    plan.punchCount += 1;
    if (!plan.name && p.name) plan.name = p.name;
    if (p.work_date < plan.firstSeen) plan.firstSeen = p.work_date;
  }
  return [...plans.values()];
}

export type AttendanceAnalysis = {
  totalRows: number;
  validPunches: number;
  invalid: InvalidRow[];
  months: string[];
  employees: Array<{ code: string | null; name: string; status: EmployeePlan["status"]; punchCount: number; firstSeen: string }>;
  newEmployees: number;
  existingEmployees: number;
  ambiguousEmployees: number;
};

export function analyzeImport(rows: AttendanceRawRow[], existing: ExistingEmployee[]): AttendanceAnalysis {
  const { punches, invalid } = parseRows(rows);
  const plans = planEmployees(punches, existing);
  const months = [...new Set(punches.map((p) => p.work_month))].sort();
  return {
    totalRows: rows.length,
    validPunches: punches.length,
    invalid,
    months,
    employees: plans
      .map((p) => ({ code: p.code, name: p.name, status: p.status, punchCount: p.punchCount, firstSeen: p.firstSeen }))
      .sort((a, b) => Number(a.code ?? 1e12) - Number(b.code ?? 1e12)),
    newEmployees: plans.filter((p) => p.status === "new").length,
    existingEmployees: plans.filter((p) => p.status === "existing").length,
    ambiguousEmployees: plans.filter((p) => p.status === "ambiguous").length,
  };
}

export type ImportSummary = AttendanceAnalysis & {
  createdEmployees: number;
  insertedPunches: number;
  duplicatePunches: number;
  skippedAmbiguousPunches: number;
};

/** Create any missing employees and insert punches idempotently inside the given transaction. */
export async function applyImport(client: PoolClient, rows: AttendanceRawRow[]): Promise<ImportSummary> {
  const { punches, invalid } = parseRows(rows);
  const existing = (await client.query<ExistingEmployee>(
    "select id, code, name, normalized_name from attendance_employees",
  )).rows;
  const plans = planEmployees(punches, existing);

  const keyToId = new Map<string, string>();
  let createdEmployees = 0;
  for (const plan of plans) {
    if (plan.status === "ambiguous") continue;
    if (plan.status === "existing" && plan.existingId) {
      keyToId.set(plan.key, plan.existingId);
      continue;
    }
    // New employee. A non-empty code uses the partial unique index so a racing
    // import cannot create a duplicate; name-only employees are deduped by plan.
    const code = plan.code && plan.code.trim() ? plan.code.trim() : null;
    const inserted = await client.query<{ id: string }>(
      code
        ? `insert into attendance_employees (code, name, normalized_name, first_seen)
           values ($1,$2,$3,$4)
           on conflict (code) where code is not null and code <> ''
           do update set name = excluded.name
           returning id`
        : `insert into attendance_employees (code, name, normalized_name, first_seen)
           values ($1,$2,$3,$4) returning id`,
      [code, plan.name, plan.normalized, plan.firstSeen || null],
    );
    const id = inserted.rows[0].id;
    keyToId.set(plan.key, id);
    createdEmployees += 1;
  }

  let insertedPunches = 0;
  let skippedAmbiguousPunches = 0;
  const insertable: Array<[string, ParsedPunch]> = [];
  for (const p of punches) {
    const id = keyToId.get(punchKey(p));
    if (!id) { skippedAmbiguousPunches += 1; continue; }
    insertable.push([id, p]);
  }
  // Chunked multi-row insert; the unique index makes re-imports no-ops.
  const CHUNK = 200;
  for (let i = 0; i < insertable.length; i += CHUNK) {
    const slice = insertable.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    slice.forEach(([id, p], j) => {
      const b = j * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      params.push(id, p.punched_at, p.work_date, p.work_month, p.movement, p.adjusted, p.exception, p.name);
    });
    const result = await client.query(
      `insert into attendance_punches (employee_id, punched_at, work_date, work_month, movement, adjusted, exception, source_name)
       values ${values.join(",")}
       on conflict (employee_id, punched_at, movement) do nothing`,
      params,
    );
    insertedPunches += result.rowCount ?? 0;
  }

  const analysis = analyzeImport(rows, existing);
  return {
    ...analysis,
    invalid,
    createdEmployees,
    insertedPunches,
    duplicatePunches: insertable.length - insertedPunches,
    skippedAmbiguousPunches,
  };
}
