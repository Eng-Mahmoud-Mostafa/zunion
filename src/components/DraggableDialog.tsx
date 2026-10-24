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
const NO_DRAG = "button, a, input, select, textarea, label, option, [data-no-drag]";

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
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  ariaLabel?: string;
  modal?: boolean;
  /** Render the overlay into document.body so it is never trapped by an ancestor. */
  portal?: boolean;
  /** Only start a drag when the pointer lands on the title bar itself, not its contents. */
  dragFromEmptyArea?: boolean;
  /**
   * Center the window once on open and then keep its top-left corner fixed, even
   * while its content grows or shrinks. Without this, a flex-centered window
   * drifts every time its own list/notice changes (which looks like a jump).
   */
  centerOnce?: boolean;
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
  modal = true,
  portal = false,
  dragFromEmptyArea = false,
  centerOnce = false,
}: DraggableDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const backdropDownRef = useRef(false);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const stopDragRef = useRef<(() => void) | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [availHeight, setAvailHeight] = useState<number | undefined>(undefined);

  const applyOffset = useCallback((next: Point) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);

  /** Keeps the whole window (title bar and close button included) on screen. */
  const clampOffset = useCallback((x: number, y: number): Point => {
    const node = dialogRef.current;
    if (!node) return { x, y };
    const rect = node.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width - EDGE);
    const maxY = Math.max(0, window.innerHeight - rect.height - EDGE);
    return {
      x: Math.min(Math.max(x, -maxX), maxX),
      y: Math.min(Math.max(y, -maxY), maxY),
    };
  }, []);

  // Center once on open, then leave the window exactly where it is. The offset
  // converts the (one-time) centered position into a fixed one, and the overlay
  // is top-left aligned, so later content growth extends downward instead of
  // re-centering the window.
  useLayoutEffect(() => {
    if (!centerOnce) return;
    const dialog = dialogRef.current;
    const overlay = overlayRef.current;
    if (!dialog || !overlay) return;
    const o = overlay.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    const cur = offsetRef.current;
    const naturalLeft = d.left - cur.x;
    const naturalTop = d.top - cur.y;
    const desiredLeft = Math.max(o.left + EDGE, o.left + (o.width - d.width) / 2);
    const desiredTop = Math.max(o.top + EDGE, o.top + (o.height - d.height) / 2);
    setAvailHeight(Math.max(160, Math.round(o.bottom - desiredTop - EDGE)));
    applyOffset(clampOffset(desiredLeft - naturalLeft, desiredTop - naturalTop));
  }, [centerOnce, applyOffset, clampOffset]);

  // Re-clamp when the viewport shrinks so the window can never end up off-screen.
  useLayoutEffect(() => {
    const onResize = () => {
      applyOffset(clampOffset(offsetRef.current.x, offsetRef.current.y));
      if (centerOnce) {
        const node = dialogRef.current;
        if (node) setAvailHeight(Math.max(160, Math.round(window.innerHeight - node.getBoundingClientRect().top - EDGE)));
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [applyOffset, clampOffset, centerOnce]);

  // NOTE: there is deliberately no ResizeObserver that re-clamps on content
  // changes. Doing so moved the window whenever its own list grew (a row added,
  // a notice shown, the list refreshed) even though the user never dragged.
  // Content growth is absorbed by the dialog's own internal scrolling instead.

  useEffect(() => () => {
    stopDragRef.current?.();
  }, []);

  const onHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Dragging must begin only from an empty part of the title bar: never from
    // the title text, buttons, inputs, table rows, or scrollbars.
    if (dragFromEmptyArea && event.target !== event.currentTarget) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(NO_DRAG)) return;
    if (!dialogRef.current) return;

    // Stops the browser from starting a text selection or native drag image.
    event.preventDefault();

    const head = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    // Absolute, one-time base coordinates. Every move is computed from these
    // plus the pointer's total delta — never accumulated from the last frame.
    const baseX = offsetRef.current.x;
    const baseY = offsetRef.current.y;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const next = clampOffset(
        baseX + (moveEvent.clientX - startX),
        baseY + (moveEvent.clientY - startY),
      );
      if (next.x === offsetRef.current.x && next.y === offsetRef.current.y) return;
      moveEvent.preventDefault();
      applyOffset(next);
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

    // Pointer capture routes every subsequent event to the header, even when the
    // pointer leaves the window, so the drag can never get "stuck" following it.
    try { head.setPointerCapture(pointerId); } catch {}
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
    head.addEventListener("lostpointercapture", end);
    // Losing focus (alt-tab, OS dialog, etc.) must also end the drag.
    window.addEventListener("blur", end);
    document.body.style.setProperty("user-select", "none");
    stopDragRef.current = end;
  };

  const style: CSSProperties | undefined = (offset.x !== 0 || offset.y !== 0 || availHeight !== undefined)
    ? {
        transform: offset.x !== 0 || offset.y !== 0 ? `translate3d(${offset.x}px, ${offset.y}px, 0)` : undefined,
        maxHeight: availHeight !== undefined ? `${availHeight}px` : undefined,
      }
    : undefined;

  const dialog = (
    <div
      ref={dialogRef}
      className={`${dialogClassName} dd-dialog`}
      style={style}
      role="dialog"
      aria-modal={modal ? "true" : "false"}
      aria-label={ariaLabel}
    >
      <div className={`${headClassName} dd-head`} onPointerDown={onHeadPointerDown}>
        {title}
          {showCloseButton ? (
            <button type="button" className={closeClassName} aria-label={closeLabel || "إغلاق"} title={closeLabel || "إغلاق"} disabled={closeDisabled} onClick={onClose}>
              <svg className="close-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
      </div>
      {children}
    </div>
  );

  if (!modal) {
    return portal ? createPortal(dialog, document.body) : dialog;
  }

  const overlay = (
    <div
      ref={overlayRef}
      className={overlayClassName}
      onPointerDown={(event) => {
        // Only a pointer press that STARTED on the backdrop may close it. A
        // press that started inside the dialog (e.g. dragging the window) and
        // happens to be released over the backdrop must not count as a click.
        backdropDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (closeOnBackdrop && backdropDownRef.current && event.target === event.currentTarget) onClose();
      }}
    >
      {dialog}
    </div>
  );

  // Rendering through a portal keeps the dialog out of the surrounding form's
  // layout/stacking context, so the fixed overlay truly covers the viewport and
  // never drifts with the form's scroll or relayout.
  return portal ? createPortal(overlay, document.body) : overlay;
}