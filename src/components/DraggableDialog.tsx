import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Expand, Maximize2, Minimize2, Minus, X } from "lucide-react";

const EDGE = 8;
const CASCADE = 26;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 260;
const NO_DRAG = "button, a, input, select, textarea, label, option, table, [data-no-drag]";

/**
 * Stacking for floating windows: every window that is opened or clicked takes the
 * next z-index, so the window the user is working in is always on top. Explicit
 * confirmation overlays sit above this whole range (see styles.css).
 */
let topZ = 2000;
let openWindows = 0;
const nextZ = () => ++topZ;

/**
 * Where nested floating windows render. A window that hosts its own editors (the
 * توزيع المكن board) provides a layer inside itself, so editors opened from it stay
 * above it and remain visible and usable while it is in browser fullscreen.
 */
const WindowLayerContext = createContext<HTMLElement | null>(null);

type Point = { x: number; y: number };
type Size = { w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };
type WindowMode = "normal" | "minimized" | "maximized" | "fullscreen";
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

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
  /**
   * Full window chrome: تصغير / تكبير / استعادة الحجم / ملء الشاشة buttons, resizing
   * from edges and corners, and a layer that hosts editors opened from inside it.
   */
  windowControls?: boolean;
  /** Label of the compact bar shown while the window is minimized. */
  minimizedLabel?: string;
  /** Initial size for windows with controls (clamped to the viewport). */
  defaultSize?: Size;
  /** The area تكبير fills; defaults to the viewport. */
  maximizeBounds?: () => Rect | null;
  /** Changing this value brings the window to the front (restoring it if minimized). */
  frontSignal?: number;
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
  windowControls = false,
  minimizedLabel,
  defaultSize,
  maximizeBounds,
  frontSignal,
}: DraggableDialogProps) {
  const layer = useContext(WindowLayerContext);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropDownRef = useRef(false);
  const posRef = useRef<Point | null>(null);
  const sizeRef = useRef<Size | null>(null);
  const stopDragRef = useRef<(() => void) | null>(null);
  const [pos, setPos] = useState<Point | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [z, setZ] = useState(() => nextZ());
  const [confirmClose, setConfirmClose] = useState(false);
  const [savingBeforeClose, setSavingBeforeClose] = useState(false);
  const [mode, setMode] = useState<WindowMode>("normal");
  const modeRef = useRef<WindowMode>("normal");
  modeRef.current = mode;
  const minimizedFromRef = useRef<WindowMode>("normal");
  const fullscreenFromRef = useRef<WindowMode>("normal");
  const [maxRect, setMaxRect] = useState<Rect | null>(null);
  const [ownLayer, setOwnLayer] = useState<HTMLDivElement | null>(null);

  const portalTarget = layer ?? document.body;

  const applyPos = useCallback((next: Point) => {
    posRef.current = next;
    setPos(next);
    setMaxHeight(Math.max(160, Math.round(window.innerHeight - next.y - EDGE)));
  }, []);

  const applySize = useCallback((next: Size) => {
    sizeRef.current = next;
    setSize(next);
  }, []);

  /** Keeps the whole window (title bar and controls included) inside the viewport. */
  const clampPos = useCallback((x: number, y: number): Point => {
    const node = dialogRef.current;
    const width = sizeRef.current?.w ?? node?.offsetWidth ?? 0;
    const height = Math.min(sizeRef.current?.h ?? node?.offsetHeight ?? 0, window.innerHeight - 2 * EDGE);
    return {
      x: Math.min(Math.max(x, EDGE), Math.max(EDGE, window.innerWidth - width - EDGE)),
      y: Math.min(Math.max(y, EDGE), Math.max(EDGE, window.innerHeight - height - EDGE)),
    };
  }, []);

  const computeMaxRect = useCallback((): Rect => {
    const viewport = { x: EDGE, y: EDGE, w: window.innerWidth - 2 * EDGE, h: window.innerHeight - 2 * EDGE };
    const bounds = maximizeBounds?.();
    if (!bounds) return viewport;
    const x = Math.max(bounds.x, 0);
    const y = Math.max(bounds.y, 0);
    const right = Math.min(bounds.x + bounds.w, window.innerWidth);
    const bottom = Math.min(bounds.y + bounds.h, window.innerHeight);
    return right - x < MIN_WIDTH || bottom - y < MIN_HEIGHT ? viewport : { x, y, w: right - x, h: bottom - y };
  }, [maximizeBounds]);

  // Floating windows are placed once, centred and cascaded so several open
  // windows never sit exactly on top of each other, then they stay where the
  // user leaves them: content changes and page re-renders never move them.
  // Runs once per window: re-renders of the host (new prop objects included)
  // must never re-centre, resize or otherwise move an open window.
  const defaultSizeRef = useRef(defaultSize);
  useLayoutEffect(() => {
    if (modal) return;
    const node = dialogRef.current;
    if (!node) return;
    const step = (openWindows % 6) * CASCADE;
    openWindows += 1;
    const defaultSize = defaultSizeRef.current;
    if (windowControls && defaultSize) {
      applySize({
        w: Math.max(MIN_WIDTH, Math.min(defaultSize.w, window.innerWidth - 2 * EDGE)),
        h: Math.max(MIN_HEIGHT, Math.min(defaultSize.h, window.innerHeight - 2 * EDGE)),
      });
    }
    const width = sizeRef.current?.w ?? node.offsetWidth;
    const height = Math.min(sizeRef.current?.h ?? node.offsetHeight, window.innerHeight - 2 * EDGE);
    applyPos(clampPos((window.innerWidth - width) / 2 + step, Math.max(EDGE, (window.innerHeight - height) / 2 - 40) + step));
    return () => { openWindows = Math.max(0, openWindows - 1); };
  }, [modal, windowControls, applyPos, applySize, clampPos]);

  // Re-clamp (and re-fit a maximized window) when the viewport changes, so a
  // window can never end up off-screen.
  useEffect(() => {
    if (modal) return;
    const onResize = () => {
      if (sizeRef.current) {
        const w = Math.min(sizeRef.current.w, window.innerWidth - 2 * EDGE);
        const h = Math.min(sizeRef.current.h, window.innerHeight - 2 * EDGE);
        if (w !== sizeRef.current.w || h !== sizeRef.current.h) applySize({ w, h });
      }
      if (posRef.current) applyPos(clampPos(posRef.current.x, posRef.current.y));
      if (modeRef.current === "maximized" || minimizedFromRef.current === "maximized") setMaxRect(computeMaxRect());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [modal, applyPos, applySize, clampPos, computeMaxRect]);

  // Leaving browser fullscreen (Escape, or the browser's own control) returns the
  // window to the state it was in before.
  useEffect(() => {
    if (!windowControls) return;
    const onFullscreenChange = () => {
      const isOurs = document.fullscreenElement !== null && document.fullscreenElement === dialogRef.current;
      if (isOurs && modeRef.current !== "fullscreen") setMode("fullscreen");
      else if (!isOurs && modeRef.current === "fullscreen") setMode(fullscreenFromRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [windowControls]);

  useEffect(() => () => {
    stopDragRef.current?.();
    if (document.fullscreenElement && document.fullscreenElement === dialogRef.current) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const bringToFront = () => {
    if (!modal && z !== topZ) setZ(nextZ());
  };

  // Asking for an already-open window (e.g. clicking توزيع مكن again) brings it
  // to the front and restores it if it was minimized.
  const firstSignalRef = useRef(true);
  useEffect(() => {
    if (frontSignal === undefined) return;
    if (firstSignalRef.current) { firstSignalRef.current = false; return; }
    setZ(nextZ());
    if (modeRef.current === "minimized") setMode(minimizedFromRef.current);
  }, [frontSignal]);

  const minimize = () => {
    if (mode === "minimized" || mode === "fullscreen") return;
    minimizedFromRef.current = mode;
    setMode("minimized");
  };
  const restoreFromMinimized = () => {
    setZ(nextZ());
    setMode(minimizedFromRef.current);
  };
  const maximize = () => {
    setMaxRect(computeMaxRect());
    setMode("maximized");
  };
  const restoreSize = () => {
    if (mode === "fullscreen") {
      void document.exitFullscreen().catch(() => setMode(fullscreenFromRef.current));
      return;
    }
    setMode("normal");
  };
  // The window only switches to its fullscreen layout once the browser has really
  // entered fullscreen (see the fullscreenchange listener), so a refused or
  // ignored request can never leave it stuck half-way.
  const enterFullscreen = () => {
    const node = dialogRef.current;
    if (!node || mode === "fullscreen" || !node.requestFullscreen) return;
    fullscreenFromRef.current = mode === "minimized" ? minimizedFromRef.current : mode;
    void node.requestFullscreen().catch(() => undefined);
  };

  const onHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Dragging begins only from the title bar itself: never from buttons,
    // inputs, tables or scrollbars inside it, and only in normal size.
    if (dragFromEmptyArea && event.target !== event.currentTarget) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(NO_DRAG)) return;
    if (!dialogRef.current || modal || modeRef.current !== "normal") return;

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
    trackPointer(head, pointerId, move);
  };

  /** Resizing from an edge or corner (normal size only), kept on screen and above a minimum size. */
  const onResizePointerDown = (dir: ResizeDir) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const node = dialogRef.current;
    if (!node || modeRef.current !== "normal") return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const start: Rect = { x: posRef.current?.x ?? node.offsetLeft, y: posRef.current?.y ?? node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let { x, y, w, h } = start;
      if (dir.includes("e")) w = start.w + dx;
      if (dir.includes("w")) { w = start.w - dx; x = start.x + dx; }
      if (dir.includes("s")) h = start.h + dy;
      if (dir.includes("n")) { h = start.h - dy; y = start.y + dy; }
      if (w < MIN_WIDTH) { if (dir.includes("w")) x = start.x + start.w - MIN_WIDTH; w = MIN_WIDTH; }
      if (h < MIN_HEIGHT) { if (dir.includes("n")) y = start.y + start.h - MIN_HEIGHT; h = MIN_HEIGHT; }
      if (x < EDGE) { w -= EDGE - x; x = EDGE; }
      if (y < EDGE) { h -= EDGE - y; y = EDGE; }
      if (x + w > window.innerWidth - EDGE) w = window.innerWidth - EDGE - x;
      if (y + h > window.innerHeight - EDGE) h = window.innerHeight - EDGE - y;
      applySize({ w: Math.round(w), h: Math.round(h) });
      posRef.current = { x: Math.round(x), y: Math.round(y) };
      setPos(posRef.current);
      setMaxHeight(undefined);
    };
    trackPointer(event.currentTarget, pointerId, move);
  };

  /** Pointer capture until release: the window stops the moment the button is let go. */
  const trackPointer = (handle: HTMLElement, pointerId: number, move: (event: PointerEvent) => void) => {
    const end = (endEvent?: Event) => {
      const id = (endEvent as PointerEvent | undefined)?.pointerId;
      if (id !== undefined && id !== pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      window.removeEventListener("blur", end);
      try { if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId); } catch {}
      document.body.style.removeProperty("user-select");
      stopDragRef.current = null;
    };
    try { handle.setPointerCapture(pointerId); } catch {}
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
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

  const shownMode = mode === "minimized" ? minimizedFromRef.current : mode;
  const rect: Rect | null = shownMode === "maximized" && maxRect
    ? maxRect
    : pos ? { x: pos.x, y: pos.y, w: size?.w ?? NaN, h: size?.h ?? NaN } : null;
  const floatingStyle: CSSProperties | undefined = modal
    ? undefined
    : {
        position: "fixed",
        left: rect?.x ?? 0,
        top: rect?.y ?? 0,
        width: rect && Number.isFinite(rect.w) ? rect.w : undefined,
        height: rect && Number.isFinite(rect.h) ? rect.h : undefined,
        margin: 0,
        transform: "none",
        zIndex: z,
        maxHeight: shownMode === "maximized" || size ? undefined : maxHeight,
        maxWidth: `calc(100vw - ${2 * EDGE}px)`,
        // Minimized windows stay laid out (keeping scroll positions and every
        // nested editor mounted) but are hidden and ignore the pointer.
        visibility: !pos || mode === "minimized" ? "hidden" : undefined,
        pointerEvents: mode === "minimized" ? "none" : undefined,
      };

  const controls = windowControls ? (
    <div className="dd-controls">
      {mode !== "fullscreen" && (
        <button type="button" className="dd-ctrl" title="تصغير" aria-label="تصغير" onClick={minimize}><Minus size={16} /></button>
      )}
      {mode === "maximized" || mode === "fullscreen" ? (
        <button type="button" className="dd-ctrl" title="استعادة الحجم" aria-label="استعادة الحجم" onClick={restoreSize}><Minimize2 size={15} /></button>
      ) : (
        <button type="button" className="dd-ctrl" title="تكبير" aria-label="تكبير" onClick={maximize}><Maximize2 size={15} /></button>
      )}
      {mode !== "fullscreen" && (
        <button type="button" className="dd-ctrl" title="ملء الشاشة" aria-label="ملء الشاشة" onClick={enterFullscreen}><Expand size={15} /></button>
      )}
      {showCloseButton && (
        <button type="button" className="dd-ctrl dd-ctrl-close" title={closeLabel || "إغلاق"} aria-label={closeLabel || "إغلاق"} disabled={closeDisabled} onClick={requestClose}><X size={17} /></button>
      )}
    </div>
  ) : null;

  const unsavedPrompt = confirmClose ? (
    <div className="dd-confirm-overlay" role="presentation">
      <div className="tab-confirm" role="alertdialog" aria-modal="true" aria-label="تغييرات غير محفوظة">
        <h3>توجد تغييرات غير محفوظة</h3>
        <p className="muted">{onSave ? "هل تريد حفظ التغييرات قبل إغلاق النافذة؟" : "ستُفقد التغييرات غير المحفوظة إذا أُغلقت النافذة."}</p>
        <div className="tab-confirm-actions">
          {onSave && <button type="button" className="primary-btn" onClick={() => void saveThenClose()} disabled={savingBeforeClose}>{savingBeforeClose ? "جارٍ الحفظ..." : "حفظ"}</button>}
          <button type="button" className="ghost-btn" onClick={() => { setConfirmClose(false); onClose(); }} disabled={savingBeforeClose}>تجاهل التغييرات</button>
          <button type="button" className="ghost-btn" onClick={() => setConfirmClose(false)} disabled={savingBeforeClose}>إلغاء</button>
        </div>
      </div>
    </div>
  ) : null;

  const dialog = (
    <div
      ref={dialogRef}
      className={`${dialogClassName} dd-dialog${modal ? "" : " dd-floating"}${windowControls ? ` dd-window dd-mode-${mode}` : ""}`}
      style={floatingStyle}
      role="dialog"
      aria-modal={modal ? "true" : "false"}
      aria-label={ariaLabel}
      aria-hidden={mode === "minimized" ? true : undefined}
      onPointerDownCapture={bringToFront}
      onFocusCapture={bringToFront}
    >
      <div className={`${headClassName} dd-head`} onPointerDown={onHeadPointerDown}>
        {title}
        {windowControls ? controls : showCloseButton ? (
          <button type="button" className={closeClassName} aria-label={closeLabel || "إغلاق"} title={closeLabel || "إغلاق"} disabled={closeDisabled} onClick={requestClose}>
            <svg className="close-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
      {windowControls ? (
        <WindowLayerContext.Provider value={ownLayer}>{children}</WindowLayerContext.Provider>
      ) : children}
      {windowControls && mode === "normal" && RESIZE_DIRS.map((dir) => (
        <div key={dir} className={`dd-resize dd-resize-${dir}`} onPointerDown={onResizePointerDown(dir)} aria-hidden="true" />
      ))}
      {windowControls && <div ref={setOwnLayer} className="dd-window-layer" />}
      {/* In fullscreen only the window itself is visible, so its prompt renders inside it. */}
      {mode === "fullscreen" ? unsavedPrompt : null}
    </div>
  );

  if (!modal) {
    // Floating windows live in document.body (or their host window's layer):
    // fixed to the viewport, never clipped by a scrolling page, and untouched by
    // re-renders of the page.
    return (
      <>
        {createPortal(dialog, portalTarget)}
        {mode !== "fullscreen" && unsavedPrompt ? createPortal(unsavedPrompt, portalTarget) : null}
        {mode === "minimized" && createPortal(
          <button type="button" className="dd-minimized-bar" title={`استعادة ${minimizedLabel || ariaLabel || ""}`.trim()} onClick={restoreFromMinimized}>
            <Maximize2 size={14} />
            <span>{minimizedLabel || ariaLabel}</span>
          </button>,
          portalTarget,
        )}
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
      {unsavedPrompt ? createPortal(unsavedPrompt, document.body) : null}
    </>
  );
}
