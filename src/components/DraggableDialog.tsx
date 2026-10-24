import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const EDGE = 8;
const CASCADE = 26;
const NO_DRAG = "button, a, input, select, textarea, label, option, table, [data-no-drag]";

/**
 * Stacking for floating windows: every window that is opened or clicked takes the
 * next z-index, so the window the user is working in is always on top. Explicit
 * confirmation overlays sit above this whole range (see styles.css).
 */
let topZ = 2000;
let openWindows = 0;
const nextZ = () => ++topZ;

type Point = { x: number; y: number };

export type DraggableDialogProps = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  overlayClassName?: string;
  dialogClassName: string;
  headClassName: string;
  closeClassName?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
  /** Modal dialogs only (explicit confirmations): close when the backdrop is clicked. */
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  ariaLabel?: string;
  /**
   * false (default): a floating, non-modal window. No backdrop, nothing outside it
   * closes it, several can be open at once, and the page stays usable.
   * true: a blocking dialog with a backdrop, for explicit confirmations only.
   */
  modal?: boolean;
  /** Modal dialogs only: render into document.body. Floating windows always do. */
  portal?: boolean;
  /** Only start a drag when the pointer lands on the title bar itself, not its contents. */
  dragFromEmptyArea?: boolean;
  /** The window holds edits that are not saved yet; × then asks حفظ / تجاهل التغييرات / إلغاء. */
  dirty?: boolean;
  /** Saves the window's pending edits; resolve false when saving failed (the window stays open). */
  onSave?: () => Promise<boolean | void> | boolean | void;
};

export function DraggableDialog({
  title,
  onClose,
  children,
  overlayClassName,
  dialogClassName,
  headClassName,
  closeClassName = "ws-modal-close",
  closeLabel = "إغلاق",
  closeDisabled,
  closeOnBackdrop = true,
  showCloseButton = true,
  ariaLabel,
  modal = false,
  portal = false,
  dragFromEmptyArea = false,
  dirty = false,
  onSave,
}: DraggableDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropDownRef = useRef(false);
  const posRef = useRef<Point | null>(null);
  const stopDragRef = useRef<(() => void) | null>(null);
  const [pos, setPos] = useState<Point | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [z, setZ] = useState(() => nextZ());
  const [confirmClose, setConfirmClose] = useState(false);
  const [savingBeforeClose, setSavingBeforeClose] = useState(false);

  const applyPos = useCallback((next: Point) => {
    posRef.current = next;
    setPos(next);
    setMaxHeight(Math.max(160, Math.round(window.innerHeight - next.y - EDGE)));
  }, []);

  /** Keeps the whole window (title bar and × included) inside the viewport. */
  const clampPos = useCallback((x: number, y: number): Point => {
    const node = dialogRef.current;
    const width = node?.offsetWidth ?? 0;
    const height = Math.min(node?.offsetHeight ?? 0, window.innerHeight - 2 * EDGE);
    return {
      x: Math.min(Math.max(x, EDGE), Math.max(EDGE, window.innerWidth - width - EDGE)),
      y: Math.min(Math.max(y, EDGE), Math.max(EDGE, window.innerHeight - height - EDGE)),
    };
  }, []);

  // Floating windows are placed once, centred and cascaded so several open
  // windows never sit exactly on top of each other, then they stay where the
  // user leaves them: content changes and page re-renders never move them.
  useLayoutEffect(() => {
    if (modal) return;
    const node = dialogRef.current;
    if (!node) return;
    const step = (openWindows % 6) * CASCADE;
    openWindows += 1;
    const width = node.offsetWidth;
    const height = Math.min(node.offsetHeight, window.innerHeight - 2 * EDGE);
    applyPos(clampPos((window.innerWidth - width) / 2 + step, Math.max(EDGE, (window.innerHeight - height) / 2 - 40) + step));
    return () => { openWindows = Math.max(0, openWindows - 1); };
  }, [modal, applyPos, clampPos]);

  // Re-clamp when the viewport shrinks so a window can never end up off-screen.
  useEffect(() => {
    if (modal) return;
    const onResize = () => {
      if (posRef.current) applyPos(clampPos(posRef.current.x, posRef.current.y));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [modal, applyPos, clampPos]);

  useEffect(() => () => {
    stopDragRef.current?.();
  }, []);

  const bringToFront = () => {
    if (!modal && z !== topZ) setZ(nextZ());
  };

  const onHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Dragging begins only from the title bar itself: never from buttons,
    // inputs, tables or scrollbars inside it.
    if (dragFromEmptyArea && event.target !== event.currentTarget) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(NO_DRAG)) return;
    if (!dialogRef.current || modal) return;

    // Stops the browser from starting a text selection or native drag image.
    event.preventDefault();

    const head = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    // Absolute base coordinates: every move is base + total pointer delta, never
    // accumulated frame by frame, so the window cannot drift.
    const base = posRef.current ?? { x: dialogRef.current.offsetLeft, y: dialogRef.current.offsetTop };

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const next = clampPos(base.x + (moveEvent.clientX - startX), base.y + (moveEvent.clientY - startY));
      if (posRef.current && next.x === posRef.current.x && next.y === posRef.current.y) return;
      moveEvent.preventDefault();
      applyPos(next);
    };
    const end = (endEvent?: Event) => {
      const id = (endEvent as PointerEvent | undefined)?.pointerId;
      if (id !== undefined && id !== pointerId) return;
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", end);
      head.removeEventListener("pointercancel", end);
      head.removeEventListener("lostpointercapture", end);
      window.removeEventListener("blur", end);
      try { if (head.hasPointerCapture(pointerId)) head.releasePointerCapture(pointerId); } catch {}
      document.body.style.removeProperty("user-select");
      stopDragRef.current = null;
    };

    // Pointer capture routes every event to the title bar until release, so the
    // window stops the moment the button is let go, wherever the pointer is.
    try { head.setPointerCapture(pointerId); } catch {}
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
    head.addEventListener("lostpointercapture", end);
    window.addEventListener("blur", end);
    document.body.style.setProperty("user-select", "none");
    stopDragRef.current = end;
  };

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const saveThenClose = async () => {
    if (!onSave || savingBeforeClose) return;
    setSavingBeforeClose(true);
    try {
      const result = await onSave();
      setConfirmClose(false);
      if (result !== false) onClose();
    } catch {
      setConfirmClose(false);
    } finally {
      setSavingBeforeClose(false);
    }
  };

  const floatingStyle: CSSProperties | undefined = modal
    ? undefined
    : {
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        margin: 0,
        transform: "none",
        zIndex: z,
        maxHeight,
        maxWidth: `calc(100vw - ${2 * EDGE}px)`,
        visibility: pos ? undefined : "hidden",
      };

  const dialog = (
    <div
      ref={dialogRef}
      className={`${dialogClassName} dd-dialog${modal ? "" : " dd-floating"}`}
      style={floatingStyle}
      role="dialog"
      aria-modal={modal ? "true" : "false"}
      aria-label={ariaLabel}
      onPointerDownCapture={bringToFront}
      onFocusCapture={bringToFront}
    >
      <div className={`${headClassName} dd-head`} onPointerDown={onHeadPointerDown}>
        {title}
        {showCloseButton ? (
          <button type="button" className={closeClassName} aria-label={closeLabel || "إغلاق"} title={closeLabel || "إغلاق"} disabled={closeDisabled} onClick={requestClose}>
            <svg className="close-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );

  const unsavedPrompt = confirmClose
    ? createPortal(
        <div className="dd-confirm-overlay" role="presentation">
          <div className="tab-confirm" role="alertdialog" aria-modal="true" aria-label="تغييرات غير محفوظة">
            <h3>توجد تغييرات غير محفوظة</h3>
            <p className="muted">هل تريد حفظ التغييرات قبل إغلاق النافذة؟</p>
            <div className="tab-confirm-actions">
              {onSave && <button type="button" className="primary-btn" onClick={() => void saveThenClose()} disabled={savingBeforeClose}>{savingBeforeClose ? "جارٍ الحفظ..." : "حفظ"}</button>}
              <button type="button" className="ghost-btn" onClick={() => { setConfirmClose(false); onClose(); }} disabled={savingBeforeClose}>تجاهل التغييرات</button>
              <button type="button" className="ghost-btn" onClick={() => setConfirmClose(false)} disabled={savingBeforeClose}>إلغاء</button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  if (!modal) {
    // Floating windows live in document.body: fixed to the viewport, never
    // clipped by a scrolling page, and untouched by re-renders of the page.
    return (
      <>
        {createPortal(dialog, document.body)}
        {unsavedPrompt}
      </>
    );
  }

  const overlay = (
    <div
      className={overlayClassName}
      onPointerDown={(event) => {
        // Only a press that STARTED on the backdrop may close a modal dialog.
        backdropDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (closeOnBackdrop && backdropDownRef.current && event.target === event.currentTarget) requestClose();
      }}
    >
      {dialog}
    </div>
  );

  return (
    <>
      {portal ? createPortal(overlay, document.body) : overlay}
      {unsavedPrompt}
    </>
  );
}
