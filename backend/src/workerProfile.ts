/** Stable keys stored in worker records; extend this registry for future departments. */
export const WORKER_DEPARTMENT_LABELS: Record<string,string> = {
 operation: "تشغيل تطريز", printing: "الطباعة", sewing: "الخياطة",
 finishing: "التشطيب", crafts: "الصنايعية", supervision: "الإشراف",
};
export const WORKER_DEPARTMENTS = new Set(Object.keys(WORKER_DEPARTMENT_LABELS));
export const PAYMENT_METHOD_LABELS = { hourly: "بالساعة", daily: "باليوم", monthly: "بالشهر" } as const;
/** Text with a constraint, rather than a database enum, permits future extensions. */
export const WORKER_PROFILE_DDL = `alter table workers add column if not exists payment_method text
 check (payment_method in ('hourly','daily','monthly'));`;
