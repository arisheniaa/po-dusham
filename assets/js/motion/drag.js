/* drag.js — прямое манипулирование (apple-design §2, §5, §6, §9, §10)
   · 1:1 за указателем, от точки захвата (дельта, не прыжок к пальцу)
   · порог направления 10 px: пока жест не выбрал ось, страница скроллится как обычно
   · резина у границ: rubber(o, dim, 0.55)
   · проекция импульса: project(v, 0.998) = (v/1000)·d/(1−d)
   · скорость отпускания — по последним ≤6 событиям моложе 100 мс (остановился и отпустил → 0) */

export const DECELERATION = 0.998;
export const RUBBER = 0.55;
export const THRESHOLD = 10;

/** куда уедет движение со скоростью v (px/s) при затухании как у скролла; результат в px */
export const project = (v, d = DECELERATION) => ((v / 1000) * d) / (1 - d);

/** мягкая граница: чем дальше за край, тем меньше следует. o ≥ 0 — выход за край в px, dim — размер области */
export const rubber = (o, dim, c = RUBBER) => (o * dim * c) / (dim + c * Math.abs(o));

/** значение с резиной за краями [lo, hi]; dim — размер области в тех же единицах, что x */
export function rubberClamp(x, lo, hi, dim, c = RUBBER) {
  if (x < lo) return lo - rubber(lo - x, dim, c);
  if (x > hi) return hi + rubber(x - hi, dim, c);
  return x;
}

/** ближайшая к `x` из `points` */
export const nearest = (points, x) => points.reduce((m, s) => (Math.abs(s - x) < Math.abs(m - x) ? s : m), points[0]);

export class VelocityTracker {
  constructor(max = 6, maxAge = 100) { this.max = max; this.maxAge = maxAge; this.s = []; }
  reset() { this.s.length = 0; }
  push(t, x) { this.s.push({ t, x }); if (this.s.length > this.max) this.s.shift(); }
  /** px/s на момент `now` (в той же шкале, что e.timeStamp) */
  velocity(now) {
    const s = this.s.filter(p => now - p.t <= this.maxAge);
    if (s.length < 2) return 0;
    const a = s[0], b = s[s.length - 1];
    return b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
  }
}

/**
 * Жест по одной оси.
 * @param {Element} el
 * @param {{
 *  axis?: 'x'|'y', threshold?: number, touchAction?: string|false,
 *  canStart?: (e:PointerEvent)=>boolean,
 *  onDown?: (e:PointerEvent)=>void,   // сразу на нажатие: отклик, не ждёт отпускания
 *  onStart?: (e:PointerEvent)=>void,  // жест выбрал ось, с этого момента 1:1
 *  onMove?: (m:{d:number, v:number, e:PointerEvent})=>void,  // d — смещение вдоль оси от точки захвата
 *  onEnd?: (m:{d:number, v:number, e:PointerEvent, cancelled:boolean})=>void,  // v — px/s вдоль оси
 *  onTap?: (e:PointerEvent)=>void,    // нажали и отпустили без жеста
 * }} o
 */
export function createDrag(el, o = {}) {
  const axis = o.axis ?? 'x', thr = o.threshold ?? THRESHOLD;
  if (o.touchAction !== false) el.style.touchAction = o.touchAction ?? (axis === 'x' ? 'pan-y' : 'none');
  const tr = new VelocityTracker();
  let id = null, mode = 'idle'; // idle | pending | drag | scroll
  let x0 = 0, y0 = 0, o0 = 0, d = 0, swallow = false;
  const along = e => (axis === 'x' ? e.clientX : e.clientY);

  const claim = e => {
    mode = 'drag'; try { el.setPointerCapture(id); } catch (_) { /* указатель уже ушёл */ }
    o0 = along(e); d = 0; tr.reset(); tr.push(e.timeStamp, o0); // отсчёт с точки выбора оси: нет прыжка на величину порога
    o.onStart?.(e);
  };
  const down = e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (mode !== 'idle') return;
    if (o.canStart && !o.canStart(e)) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY; tr.reset(); tr.push(e.timeStamp, along(e));
    mode = 'pending';
    o.onDown?.(e);
    if (e.pointerType === 'mouse') claim(e); // мышь со скроллом не спорит, берём сразу
  };
  const move = e => {
    if (e.pointerId !== id) return;
    if (mode === 'pending') {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      const a = axis === 'x' ? dx : dy, c = axis === 'x' ? dy : dx;
      if (Math.abs(a) > thr && Math.abs(a) > Math.abs(c)) claim(e);
      else if (Math.abs(c) > thr) mode = 'scroll'; // ось не наша: отдаём странице
      return;
    }
    if (mode !== 'drag') return;
    tr.push(e.timeStamp, along(e));
    d = along(e) - o0;
    o.onMove?.({ d, v: tr.velocity(e.timeStamp), e });
  };
  const up = e => {
    if (e.pointerId !== id) return;
    const was = mode, cancelled = e.type === 'pointercancel';
    id = null; mode = 'idle';
    if (was === 'drag') {
      swallow = true; setTimeout(() => (swallow = false), 0);
      o.onEnd?.({ d, v: cancelled ? 0 : tr.velocity(e.timeStamp), e, cancelled });
    } else if (was === 'pending' && !cancelled) o.onTap?.(e);
    else o.onEnd?.({ d: 0, v: 0, e, cancelled: true });
  };
  const click = e => { if (swallow) { e.stopPropagation(); e.preventDefault(); } };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('click', click, true);
  return {
    get dragging() { return mode === 'drag'; },
    destroy() {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
    },
  };
}
