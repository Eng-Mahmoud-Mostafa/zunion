export type CreatorRecord = {creator_name?:unknown;creator_name_snapshot?:unknown;created_by?:unknown;added_by?:unknown;username?:unknown};
/** The creator is order metadata, never a role-gated administrative profile lookup. */
export function creatorName(order:CreatorRecord):string {
 const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
 return [order.creator_name,order.creator_name_snapshot,order.created_by,order.added_by,order.username]
  .map(value=>String(value??"").trim()).find(value=>value&&value!=="مستخدم غير معروف"&&!uuid.test(value))||"مستخدم غير معروف";
}
