import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../locale";

type View = { x: number; y: number; scale: number };
const limit = (scale: number) => Math.max(0.08, Math.min(2, scale));

export function Canvas({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const fitArea = useRef<HTMLDivElement>(null);
  const automatic = useRef(true);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const current = useRef(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    view: View;
    x: number;
    y: number;
    distance: number;
  } | null>(null);
  current.current = view;

  function fit() {
    const el = world.current,
      area = fitArea.current,
      root = viewport.current;
    if (!el || !area || !root) return;
    const bounds = area.getBoundingClientRect(),
      outer = root.getBoundingClientRect();
    const scale = limit(
      Math.min(
        1,
        bounds.width / el.offsetWidth,
        bounds.height / el.offsetHeight,
      ),
    );
    setView({
      x: bounds.left - outer.left + (bounds.width - el.offsetWidth * scale) / 2,
      y: bounds.top - outer.top + (bounds.height - el.offsetHeight * scale) / 2,
      scale,
    });
  }
  function zoom(factor: number, x?: number, y?: number) {
    automatic.current = false;
    const el = viewport.current!;
    const cx = x ?? el.clientWidth / 2,
      cy = y ?? el.clientHeight / 2;
    setView((v) => {
      const scale = limit(v.scale * factor),
        ratio = scale / v.scale;
      return { x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio, scale };
    });
  }
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (automatic.current) fit();
    });
    [world.current!, fitArea.current!].forEach((el) => observer.observe(el));
    fit();
    const root = viewport.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      automatic.current = false;
      if (e.ctrlKey || e.metaKey) {
        const bounds = root.getBoundingClientRect();
        zoom(
          Math.exp(-e.deltaY * 0.01),
          e.clientX - bounds.left,
          e.clientY - bounds.top,
        );
      } else {
        const unit =
          e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
        setView((v) => ({
          ...v,
          x: v.x - e.deltaX * unit,
          y: v.y - e.deltaY * unit,
        }));
      }
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      root.removeEventListener("wheel", wheel);
    };
  }, []);

  function startGesture() {
    const [a, b] = [...pointers.current.values()];
    gesture.current = a
      ? {
          view: current.current,
          x: b ? (a.x + b.x) / 2 : a.x,
          y: b ? (a.y + b.y) / 2 : a.y,
          distance: b ? Math.hypot(b.x - a.x, b.y - a.y) : 0,
        }
      : null;
  }
  return (
    <>
      <div
        className="canvas-viewport"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label={t("System canvas")}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (
            [
              "+",
              "=",
              "-",
              "0",
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
            ].includes(e.key)
          )
            e.preventDefault();
          if (e.key === "0") {
            automatic.current = true;
            fit();
          } else if (e.key === "+" || e.key === "=") zoom(1.2);
          else if (e.key === "-") zoom(1 / 1.2);
          else if (e.key.startsWith("Arrow")) {
            automatic.current = false;
            setView((v) => ({
              ...v,
              x:
                v.x +
                (e.key === "ArrowLeft" ? 50 : e.key === "ArrowRight" ? -50 : 0),
              y:
                v.y +
                (e.key === "ArrowUp" ? 50 : e.key === "ArrowDown" ? -50 : 0),
            }));
          }
        }}
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            (e.target as HTMLElement).closest(
              "button,input,select,textarea,a,summary,[data-node],.group-summary",
            )
          )
            return;
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          startGesture();
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId) || !gesture.current) return;
          automatic.current = false;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [a, b] = [...pointers.current.values()],
            start = gesture.current;
          const x = b ? (a.x + b.x) / 2 : a.x,
            y = b ? (a.y + b.y) / 2 : a.y;
          const scale =
            b && start.distance
              ? limit(
                  (start.view.scale * Math.hypot(b.x - a.x, b.y - a.y)) /
                    start.distance,
                )
              : start.view.scale;
          const bounds = e.currentTarget.getBoundingClientRect(),
            ratio = scale / start.view.scale;
          setView({
            x: x - bounds.left - (start.x - bounds.left - start.view.x) * ratio,
            y: y - bounds.top - (start.y - bounds.top - start.view.y) * ratio,
            scale,
          });
        }}
        onLostPointerCapture={(e) => {
          pointers.current.delete(e.pointerId);
          startGesture();
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          startGesture();
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          startGesture();
        }}
      >
        <div className="canvas-fit-area" ref={fitArea} />
        <div
          className="canvas-world"
          ref={world}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          {children}
        </div>
      </div>
      <div
        className="canvas-navigation floating-block"
        aria-label={t("Canvas navigation")}
      >
        <button
          id="zoom-out"
          aria-label={t("Zoom out")}
          onClick={() => zoom(1 / 1.2)}
        >
          −
        </button>
        <output aria-label={t("Zoom")}>{Math.round(view.scale * 100)}%</output>
        <button
          id="zoom-in"
          aria-label={t("Zoom in")}
          onClick={() => zoom(1.2)}
        >
          +
        </button>
        <button
          id="fit-canvas"
          onClick={() => {
            automatic.current = true;
            fit();
          }}
        >
          {t("Fit diagram")}
        </button>
      </div>
    </>
  );
}
