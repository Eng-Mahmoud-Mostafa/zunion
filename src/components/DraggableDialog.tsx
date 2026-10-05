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

const EDGE = 8;
const NO_DRAG = "button, a, input, select, textarea, label, option, [data-no-drag]";

type Point = { x: number; y: number };

export type DraggableDialogProps = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  overlayClassName: string;
  dialogClassName: string;
  headClassName: string;
  closeClassName?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  ariaLabel?: string;
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
}: DraggableDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const stopDragRef = useRef<(() => void) | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

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

  // Re-clamp when the viewport shrinks so the window can never end up off-screen.
  useLayoutEffect(() => {
    const onResize = () => applyOffset(clampOffset(offsetRef.current.x, offsetRef.current.y));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [applyOffset, clampOffset]);

  // Same for content that grows while the window sits near an edge.
  useLayoutEffect(() => {
    const node = dialogRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => applyOffset(clampOffset(offsetRef.current.x, offsetRef.current.y)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [applyOffset, clampOffset]);

  useEffect(() => () => {
    stopDragRef.current?.();
  }, []);

  const onHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(NO_DRAG)) return;
    if (!dialogRef.current) return;

    // Stops the browser from starting a text selection or native drag image.
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = offsetRef.current.x;
    const baseY = offsetRef.current.y;

    const move = (moveEvent: PointerEvent) => {
      const next = clampOffset(
        baseX + (moveEvent.clientX - startX),
        baseY + (moveEvent.clientY - startY),
      );
      if (next.x === offsetRef.current.x && next.y === offsetRef.current.y) return;
      moveEvent.preventDefault();
      applyOffset(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.removeProperty("user-select");
      stopDragRef.current = null;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    document.body.style.setProperty("user-select", "none");
    stopDragRef.current = end;
  };

  const style: CSSProperties | undefined = offset.x !== 0 || offset.y !== 0
    ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }
    : undefined;

  return (
    <div
      className={overlayClassName}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`${dialogClassName} dd-dialog`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${headClassName} dd-head`} onPointerDown={onHeadPointerDown}>
          {title}
          {showCloseButton ? (
            <button type="button" className={closeClassName} aria-label={closeLabel} disabled={closeDisabled} onClick={onClose}>×</button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}