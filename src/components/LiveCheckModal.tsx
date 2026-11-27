import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * «¿Sigues ahí?» (hombre muerto del directo). Ocupa toda la ventana y no se
 * puede cerrar de otra forma que respondiendo: continuar en directo o
 * terminarlo. Al llegar a cero, quien lo muestra sale del LIVE.
 */
export function LiveCheckModal({
  deadline,
  total,
  program,
  onContinue,
  onEnd,
}: {
  /** Momento (ms) en que se agota la cuenta atrás */
  deadline: number;
  /** Segundos totales (para la barra) */
  total: number;
  program: string;
  onContinue: () => void;
  onEnd: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, []);

  // El foco se queda dentro: Intro o espacio = continuar; Esc no cierra.
  useEffect(() => {
    btn.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.key === "Tab") {
        const box = btn.current?.closest(".lcheck");
        const items = box ? Array.from(box.querySelectorAll<HTMLButtonElement>("button")) : [];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
      }
    };
    window.addEventListener("keydown", trap, true);
    return () => window.removeEventListener("keydown", trap, true);
  }, []);

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const pct = Math.max(0, Math.min(100, ((deadline - now) / (total * 1000)) * 100));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");

  return createPortal(
    <div className="lcheck-back" role="alertdialog" aria-modal="true" aria-labelledby="lcheck-title" aria-describedby="lcheck-desc">
      <div className={`lcheck ${left <= 10 ? "lcheck-urgent" : ""}`}>
        <span className="lcheck-tag">EN DIRECTO{program ? ` · ${program}` : ""}</span>
        <h1 id="lcheck-title">¿Sigues ahí?</h1>
        <div className="lcheck-count" aria-live="assertive">
          {mm > 0 ? `${mm}:${ss}` : left}
        </div>
        <div className="lcheck-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <p id="lcheck-desc">
          Si no confirmas, al llegar a cero se sale del directo y vuelve la automatización: se reanudan los eventos y la
          lista sigue con la siguiente pista.
        </p>
        <div className="lcheck-actions">
          <button ref={btn} type="button" className="lcheck-go" onClick={onContinue}>
            Continuar en directo
          </button>
          <button type="button" className="lcheck-end" onClick={onEnd}>
            Terminar el directo ahora
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
