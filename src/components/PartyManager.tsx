import { useEffect, useRef, useState, type ChangeEvent, type MutableRefObject, type ReactNode } from "react";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { DraggableDialog } from "./DraggableDialog";

/**
 * A single centrally-managed party row, as returned by /api/parties and stored
 * in local mode. Records reference a party by name (source_party), so IDs stay
 * stable for management while renames cascade onto linked orders/customers.
 */
export type PartyItem = { id: string; name: string; position: number; active: boolean };

/**
 * "أخرى" is an action, never a value. It is hidden from the managed list and
 * from every normal dropdown; only the Master dropdown appends it as the final
 * option that opens the management popup.
 */
export const OTHER_PARTY_NAME = "أخرى";

export function isOtherParty(name: string | null | undefined): boolean {
  return (name ?? "").trim() === OTHER_PARTY_NAME;
}

/** Active, managed names in display order — exactly what a normal user may pick. */
export function activePartyNames(parties: PartyItem[]): string[] {
  return parties
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((party) => party.active && !isOtherParty(party.name) && party.name.trim() !== "")
    .map((party) => party.name);
}

type ManagerNotice = { tone: "success" | "error"; text: string } | null;

type ManagerProps = {
  parties: PartyItem[];
  onCreate?: (name: string) => Promise<void> | void;
  onUpdate?: (id: string, changes: { name?: string; active?: boolean }) => Promise<void> | void;
};

/** Lets a hosting window ask for pending edits to be saved before it closes. */
export type PartyPanelControl = { saveAll: () => Promise<boolean> };

/**
 * The one and only parties management table (الاسم / الحالة / الإجراءات).
 * Shared by the Settings section and the in-form draggable popup.
 */
export function PartyManagerPanel({ parties, onCreate, onUpdate, onDirtyChange, controlRef }: ManagerProps & { onDirtyChange?: (dirty: boolean) => void; controlRef?: MutableRefObject<PartyPanelControl | null> }) {
  const list = parties
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((party) => !isOtherParty(party.name));
  const [newName, setNewName] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<ManagerNotice>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const duplicate = (name: string, ignoreId?: string) =>
    list.some((party) => party.id !== ignoreId && party.name.trim().toLowerCase() === name.trim().toLowerCase());

  const cancelEdit = (id: string) =>
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const submitNew = async (): Promise<boolean> => {
    const name = newName.trim();
    if (!name) { setNotice({ tone: "error", text: "الاسم مطلوب" }); return false; }
    if (duplicate(name)) { setNotice({ tone: "error", text: "يوجد اسم مطابق موجود" }); return false; }
    if (!onCreate) { setNotice({ tone: "error", text: "غير مصرح بإدارة الأطراف" }); return false; }
    setBusy("new");
    try {
      await onCreate(name);
      setNewName("");
      setNotice({ tone: "success", text: "تمّت إضافة الطرف" });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذّر إضافة الطرف" });
      return false;
    } finally {
      setBusy("");
    }
  };

  const saveEdit = async (party: PartyItem): Promise<boolean> => {
    const raw = (edits[party.id] ?? party.name).trim();
    if (!raw) { setNotice({ tone: "error", text: "الاسم مطلوب" }); return false; }
    if (duplicate(raw, party.id)) { setNotice({ tone: "error", text: "يوجد اسم مطابق موجود" }); return false; }
    if (raw.toLowerCase() === party.name.trim().toLowerCase()) { cancelEdit(party.id); return true; }
    if (!onUpdate) { setNotice({ tone: "error", text: "غير مصرح بإدارة الأطراف" }); return false; }
    setBusy(party.id);
    try {
      await onUpdate(party.id, { name: raw });
      cancelEdit(party.id);
      setNotice({ tone: "success", text: "تمّ تعديل الطرف" });
      return true;
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذّر تعديل الطرف" });
      return false;
    } finally {
      setBusy("");
    }
  };

  // Unsaved = a typed new name, or a rename that differs from the saved name.
  // Refreshed party lists never reset these: they are keyed by party id.
  const dirty = Boolean(newName.trim()) || list.some((party) => edits[party.id] !== undefined && edits[party.id].trim() !== party.name.trim());
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  if (controlRef) {
    controlRef.current = {
      saveAll: async () => {
        let ok = true;
        if (newName.trim()) ok = (await submitNew()) && ok;
        for (const party of list) {
          if (edits[party.id] !== undefined && edits[party.id].trim() !== party.name.trim()) ok = (await saveEdit(party)) && ok;
        }
        return ok;
      },
    };
  }

  const toggleActive = async (party: PartyItem) => {
    if (!onUpdate) { setNotice({ tone: "error", text: "غير مصرح بإدارة الأطراف" }); return; }
    setBusy(party.id);
    try {
      await onUpdate(party.id, { active: !party.active });
      setNotice({ tone: "success", text: party.active ? "تمّ إيقاف الطرف" : "تمّ تفعيل الطرف" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "تعذّر تحديث الحالة" });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="party-manager">
      <div className="party-manager-toolbar">
        <input
          className="party-manager-input"
          placeholder="اسم الطرف الجديد"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitNew(); } }}
        />
        <button type="button" className="party-btn" onClick={submitNew} disabled={busy === "new" || !onCreate}>
          {busy === "new" ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
          إضافة طرف
        </button>
      </div>
      {notice && <div className={`party-manager-notice ${notice.tone}`} role="status">{notice.text}</div>}
      <div className="party-manager-tablewrap">
        <table className="party-manager-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={3} className="party-manager-empty">لا توجد أطراف</td></tr>
            ) : list.map((party) => {
              const editing = edits[party.id] !== undefined;
              return (
                <tr key={party.id}>
                  <td>
                    {editing ? (
                      <input
                        className="party-manager-input"
                        value={edits[party.id]}
                        onChange={(event) => setEdits((prev) => ({ ...prev, [party.id]: event.target.value }))}
                      />
                    ) : (
                      <span className="party-manager-name">{party.name}</span>
                    )}
                  </td>
                  <td>
                    <span className={`party-status ${party.active ? "active" : "inactive"}`}>
                      {party.active ? "مفعّل" : "موقوف"}
                    </span>
                  </td>
                  <td>
                    <div className="party-manager-actions">
                      {editing ? (
                        <>
                          <button type="button" className="party-btn" onClick={() => void saveEdit(party)} disabled={busy === party.id}>
                            <Check size={14} /> حفظ
                          </button>
                          <button type="button" className="party-btn ghost" onClick={() => cancelEdit(party.id)} disabled={busy === party.id}>
                            <X size={14} /> إلغاء
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="party-btn ghost" onClick={() => setEdits((prev) => ({ ...prev, [party.id]: party.name }))} disabled={!!busy}>
                            <Pencil size={14} /> تعديل
                          </button>
                          <button type="button" className={`party-btn${party.active ? " ghost" : ""}`} onClick={() => void toggleActive(party)} disabled={busy === party.id}>
                            {party.active ? "إيقاف" : "تفعيل"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Floating white/red window titled إدارة الأطراف, opened straight from a form. */
export function PartyModal({ parties, onCreate, onUpdate, onClose }: ManagerProps & { onClose: () => void }) {
  const [dirty, setDirty] = useState(false);
  const controlRef = useRef<PartyPanelControl | null>(null);
  return (
    <DraggableDialog
      dialogClassName="party-modal"
      headClassName="party-modal-head"
      closeClassName="party-modal-close"
      ariaLabel="إدارة الأطراف"
      onClose={onClose}
      title={<h2>إدارة الأطراف</h2>}
      dragFromEmptyArea
      dirty={dirty}
      onSave={() => controlRef.current?.saveAll() ?? true}
    >
      <PartyManagerPanel parties={parties} onCreate={onCreate} onUpdate={onUpdate} onDirtyChange={setDirty} controlRef={controlRef} />
    </DraggableDialog>
  );
}

type PartySelectProps = {
  value: string;
  onChange: (name: string) => void;
  parties: PartyItem[];
  /** Master gets the trailing "أخرى" action and management popup. */
  canManage: boolean;
  onCreate?: (name: string) => Promise<void> | void;
  onUpdate?: (id: string, changes: { name?: string; active?: boolean }) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: ReactNode;
};

/**
 * The single shared party dropdown used in أوردر جديد, إضافة عميل, editing forms
 * and every other party picker. Normal users see active names only; the Master
 * additionally sees "أخرى" as the final option which opens the management popup
 * without changing the current selection.
 */
export function PartySelect({ value, onChange, parties, canManage, onCreate, onUpdate, disabled, placeholder }: PartySelectProps) {
  const [open, setOpen] = useState(false);
  const names = activePartyNames(parties);
  const legacy = value && !isOtherParty(value) && !names.includes(value) ? value : "";

  const onSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (canManage && next === OTHER_PARTY_NAME) {
      event.target.value = value;
      setOpen(true);
      return;
    }
    onChange(next);
  };

  return (
    <>
      <select value={value} onChange={onSelectChange} disabled={disabled}>
        {(placeholder ?? !value) ? <option value="" disabled hidden>{placeholder ?? "اختر الطرف"}</option> : null}
        {legacy ? <option value={legacy} disabled>{legacy}</option> : null}
        {names.map((name) => <option key={name} value={name}>{name}</option>)}
        {canManage ? <option value={OTHER_PARTY_NAME}>{OTHER_PARTY_NAME}</option> : null}
      </select>
      {/* Opening needs canManage; once open, the window stays until it is closed,
          even if the hosting form switches to read-only after a save. */}
      {open ? (
        <PartyModal
          parties={parties}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
