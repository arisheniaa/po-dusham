/* spring.js — пружина по apple-design: damping ratio (ζ) + response (с).
   stiffness k = (2π / response)², damping c = 4π·ζ / response, масса 1.
   Прерываемая: to() всегда стартует от ТЕКУЩЕГО значения и несёт текущую скорость (§3, §5).
   Скорость — в единицах значения за секунду (не относительная).
   Один общий rAF на все пружины; когда все осели — такт останавливается (ничего не крутится вхолостую). */

const TAU = Math.PI * 2;

let rmQuery = null;
/** prefers-reduced-motion: reduce (живой, обновляется при смене настройки) */
export function prefersReducedMotion() {
  if (!rmQuery) rmQuery = matchMedia('(prefers-reduced-motion: reduce)');
  return rmQuery.matches;
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** ζ + response → физика (масса 1) */
export function coefficients(response, damping) {
  return { k: (TAU / response) ** 2, c: (2 * TAU * damping) / response };
}

/* ---------- общий такт ---------- */
const active = new Set();
let raf = 0, last = 0;
export const stats = { frames: 0, maxDt: 0, running: false };
const MAX_DT = 0.064;      // длинный кадр не должен «взрывать» интеграцию
const SUBSTEP = 1 / 240;   // устойчиво для response ≥ 0.1

function wake(s) {
  active.add(s);
  if (!raf) { last = performance.now(); stats.running = true; raf = requestAnimationFrame(tick); }
}
function tick(now) {
  const dt = Math.min(MAX_DT, (now - last) / 1000); last = now;
  stats.frames++; stats.maxDt = Math.max(stats.maxDt, dt);
  const n = Math.max(1, Math.ceil(dt / SUBSTEP)), h = dt / n;
  for (const s of Array.from(active)) {
    for (let i = 0; i < n; i++) s._step(h);
    if (s._settled()) { s.x = s.t; s.v = 0; active.delete(s); s.onFrame(s.x, true); s._done?.(); }
    else s.onFrame(s.x, false);
  }
  raf = active.size ? requestAnimationFrame(tick) : 0;
  if (!raf) stats.running = false;
}

export class Spring {
  /**
   * @param {number} x       начальное значение
   * @param {{response?:number, damping?:number, rest?:number, instantOnReduced?:boolean}} o
   * @param {(x:number, settled:boolean)=>void} onFrame
   */
  constructor(x, o = {}, onFrame = () => {}) {
    this.x = x; this.t = x; this.v = 0; this.onFrame = onFrame;
    this.rest = o.rest ?? 1e-4;
    this.instantOnReduced = o.instantOnReduced ?? true;
    this.setParams(o.response ?? 0.4, o.damping ?? 1);
  }
  setParams(response, damping) {
    this.response = response; this.damping = damping;
    Object.assign(this, (({ k, c }) => ({ k, c }))(coefficients(response, damping)));
    return this;
  }
  /** новая цель; velocity не задана → сохраняется текущая (непрерывность при ретаргете) */
  to(target, { velocity, response, damping } = {}) {
    if (response !== undefined || damping !== undefined) this.setParams(response ?? this.response, damping ?? this.damping);
    this.t = target;
    if (velocity !== undefined) this.v = velocity;
    if (this.instantOnReduced && prefersReducedMotion()) { this.jump(target); return this; }
    wake(this);
    return this;
  }
  /** взять в руку: остановить и вернуть живое состояние (presentation value) */
  grab() { active.delete(this); const s = { x: this.x, v: this.v }; this.v = 0; this.t = this.x; return s; }
  /** поставить значение без анимации (скорость 0) */
  jump(x) { active.delete(this); this.x = this.t = x; this.v = 0; this.onFrame(x, true); return this; }
  /** писать значение под палец: x и цель сразу, пружина спит */
  set(x) { active.delete(this); this.x = this.t = x; this.v = 0; this.onFrame(x, false); return this; }
  stop() { active.delete(this); return this; }
  get active() { return active.has(this); }
  onSettle(fn) { this._done = fn; return this; }
  _step(dt) { const a = -this.k * (this.x - this.t) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; }
  _settled() { return Math.abs(this.x - this.t) < this.rest && Math.abs(this.v) < this.rest * 10; }
}

/* ---------- чистая симуляция: графики, время оседания, CSS linear() ---------- */

/** массив значений пружины 0→1 с шагом dt (для графика и linear()) */
export function sample({ damping = 1, response = 0.4, from = 0, to = 1, velocity = 0, dt = 1 / 120, maxT = 6 } = {}) {
  const { k, c } = coefficients(response, damping);
  let x = from, v = velocity; const out = [x];
  const eps = 1e-3 * Math.max(1, Math.abs(to - from));
  for (let t = 0; t < maxT; t += dt) {
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; }
    out.push(x);
    if (Math.abs(x - to) < eps && Math.abs(v) < eps * 10) break;
  }
  out[out.length - 1] = to;
  return { values: out, dt, duration: (out.length - 1) * dt };
}

/** время оседания (с) и максимальный выброс (доля) */
export function describe(damping, response) {
  const { values, duration } = sample({ damping, response, dt: 1 / 240 });
  return { settle: duration, overshoot: Math.max(0, Math.max(...values) - 1) };
}

/** пружина как CSS-кривая: `linear(...)` + длительность в мс. Для входов, которым нельзя ждать JS
    (hero «кадр открывается» — первая секунда страницы на чистом CSS, по тем же ζ/response). */
export function toCssLinear({ damping = 1, response = 0.4, points = 36 } = {}) {
  const { values, duration } = sample({ damping, response, dt: 1 / 240 });
  const pts = [];
  for (let i = 0; i < points; i++) {
    const idx = Math.round((i / (points - 1)) * (values.length - 1));
    pts.push(+values[idx].toFixed(4));
  }
  // линейный участок по времени равномерен, поэтому рассчитываем по индексам
  return { easing: `linear(${pts.join(', ')})`, duration: Math.round(duration * 1000) };
}
