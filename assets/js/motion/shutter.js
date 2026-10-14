/* shutter.js — шторка до/после: drag.js + spring.js в одной единице.
   Разметка: [data-shutter] (role=slider), CSS читает --p в %. См. MOTION-SPEC §3.3.
   Движется только перетаскиванием, касанием по кадру и клавишами (запрет лока: ничего за курсором). */

import { Spring, clamp, prefersReducedMotion } from './spring.js';
import { createDrag, project, rubberClamp, nearest, RUBBER, DECELERATION } from './drag.js';

export const SHUTTER = {
  response: 0.3, damping: 0.8,        // бросок: apple «drawer/sheet»
  tapResponse: 0.4, tapDamping: 1,    // касание/клавиши: apple «move»
  rubber: RUBBER, decel: DECELERATION, flick: 400, // px/s — порог броска
  hint: true,                         // намёк в направлении жеста 0.5 → 0.64 → 0.5, один раз
};

/** @param {HTMLElement} el  @param {typeof SHUTTER} P */
export function createShutter(el, P = SHUTTER, { onRelease } = {}) {
  const set = v => {
    const n = Math.round(clamp(v) * 100);
    el.style.setProperty('--p', (v * 100).toFixed(3) + '%');
    el.setAttribute('aria-valuenow', n);
    el.setAttribute('aria-valuetext', `до ${n} %`);
  };
  const sp = new Spring(0.5, { response: P.response, damping: P.damping }, set);
  let W = 1, x0 = 0, touched = false;
  const tap = (t, v = 0) => sp.to(clamp(t), { velocity: v, response: P.tapResponse, damping: P.tapDamping });

  const drag = createDrag(el, {
    axis: 'x',
    onDown: () => { touched = true; el.classList.add('is-grab'); W = el.getBoundingClientRect().width; },
    onStart: () => { x0 = sp.grab().x; },
    onMove: m => sp.set(rubberClamp(x0 + m.d / W, 0, 1, 1, P.rubber)),   // 1:1 от точки захвата, резина за краями
    onEnd: ({ v, cancelled }) => {
      el.classList.remove('is-grab');
      if (cancelled && !v) return;
      let target = clamp(sp.x);
      if (Math.abs(v) > P.flick) target = nearest([0, 0.5, 1], sp.x + project(v, P.decel) / W);
      onRelease?.({ v, target });
      sp.to(target, { velocity: v / W, response: P.response, damping: P.damping }); // скорость жеста → пружине
    },
    onTap: e => { el.classList.remove('is-grab'); const r = el.getBoundingClientRect(); tap((e.clientX - r.left) / r.width); },
  });

  const key = e => {
    const m = { ArrowLeft: -0.1, ArrowRight: 0.1 }[e.key];
    if (m) { e.preventDefault(); tap(sp.t + m); }
    else if (e.key === 'Home') { e.preventDefault(); tap(0); }
    else if (e.key === 'End') { e.preventDefault(); tap(1); }
  };
  el.addEventListener('keydown', key);

  let hio = null, t1 = 0, t2 = 0;
  if (P.hint && !prefersReducedMotion() && 'IntersectionObserver' in window) {
    hio = new IntersectionObserver(es => {
      if (!es[0].isIntersecting) return; hio.disconnect();
      t1 = setTimeout(() => { if (!touched) sp.to(0.64, { response: 0.5, damping: 1 }); }, 250);
      t2 = setTimeout(() => { if (!touched) sp.to(0.5, { response: 0.5, damping: 1 }); }, 900);
    }, { threshold: 0.6 });
    hio.observe(el);
  }
  set(0.5);
  return { spring: sp, destroy() { drag.destroy(); el.removeEventListener('keydown', key); hio?.disconnect(); clearTimeout(t1); clearTimeout(t2); } };
}

export function initShutters(root = document, P = SHUTTER) {
  return Array.from(root.querySelectorAll('[data-shutter]')).map(el => createShutter(el, P));
}
