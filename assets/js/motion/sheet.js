/* sheet.js — шторка записи (bottom sheet на мобайле, мягкая панель на десктопе)
   apple-design: пружины ζ/response · прерываемость · смахивание вниз 1:1 с резиной · проекция d=0.998 · передача скорости.
   Доступность: aria-modal, inert на всё остальное, фокус-ловушка, Esc, возврат фокуса, блок скролла, Back закрывает.
   Прогрессивное улучшение: без JS #zapis остаётся обычной секцией со ссылкой в мессенджер (разметка — контракт в MOTION-SPEC §6).

   Разметка (контракт):
     <div class="sheet" id="zapis" role="dialog" aria-modal="true" aria-labelledby="…">   ← прямой потомок body
       <div class="sheet__scrim" data-sheet-scrim></div>
       <div class="sheet__panel" data-sheet-panel>
         <div class="sheet__head" data-sheet-grab> …ручка… <button data-sheet-close>…</button></div>
         <div class="sheet__body" data-sheet-body>
           <section data-step> <h2 data-step-focus tabindex="-1">…</h2> … <button data-next>…</button></section>
           <section data-step> … <button data-prev>…</button></section>
         </div>
       </div>
     </div>
   Открывает любой [data-book] (или свой селектор). */

import { Spring, clamp, prefersReducedMotion } from './spring.js';
import { createDrag, project, rubberClamp, VelocityTracker, THRESHOLD } from './drag.js';

export const SHEET = {
  open: { response: 0.4, damping: 1 },     // тап «кнопка → шторка»: перемещение, без отскока (apple: move 1.0/0.4)
  snap: { response: 0.3, damping: 0.8 },   // возврат/бросок: drawer/sheet 0.8/0.3 — отскок есть только потому, что жест нёс импульс
  close: { response: 0.35, damping: 1 },   // Esc / скрим / крестик: без импульса — без отскока
  step: { response: 0.4, damping: 1 },     // вход шага
  stepOut: { response: 0.3, damping: 1 },  // уход шага: чуть быстрее
  height: { response: 0.4, damping: 1 },   // высота панели под новый шаг
  stepDist: 28,                            // сдвиг шага в px; вперёд — слева направо, назад — зеркально (§7 симметрия путей)
  desktopTravel: 28,                       // на ≥768 панель едет на 28 px и проявляется
  mobileMax: '(max-width: 767.98px)',
  projectionDecel: 0.998,
  keepStep: false,
};

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const q = (s, c) => c.querySelector(s);

export function createSheet(root, o = {}) {
  if (!root) return null;
  const cfg = { ...SHEET, ...(o.params || {}) };
  const panel = q('[data-sheet-panel]', root), scrim = q('[data-sheet-scrim]', root), body = q('[data-sheet-body]', root) || panel;
  if (!panel) return null;
  const grabs = Array.from(root.querySelectorAll('[data-sheet-grab]'));
  const openers = o.openers ?? '[data-book]';
  const mobileMQ = matchMedia(cfg.mobileMax);
  const isMobile = () => mobileMQ.matches;

  /* ---- состояние ---- */
  let state = 'closed';                 // closed | opening | open | closing
  let T = 600, rm = false, lastFocus = null, pushed = false;
  const inerted = [];
  const spring = new Spring(T, { ...cfg.open, rest: 0.25, instantOnReduced: false }, apply);

  root.classList.add('is-sheet');
  root.hidden = true;
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: o.zIndex ?? '100' });
  if (scrim) scrim.style.touchAction = 'none';
  body.style.overscrollBehaviorY = 'contain';

  function apply(y) {
    const p = clamp(1 - y / T);
    root.style.setProperty('--sheet-p', p.toFixed(4));
    if (scrim) scrim.style.opacity = p;
    if (rm) { panel.style.transform = 'none'; panel.style.opacity = p; }
    else { panel.style.transform = `translate3d(0,${y}px,0)`; panel.style.opacity = isMobile() ? '' : p; }
  }

  /* ---- блок скролла, inert, фокус ---- */
  function lockScroll() {
    const de = document.documentElement, sb = innerWidth - de.clientWidth;
    de.dataset.sheetLock = '1';
    de.style.overflow = 'hidden';
    if (sb > 0) { de.style.paddingRight = sb + 'px'; de.style.setProperty('--sbw', sb + 'px'); }
  }
  function unlockScroll() {
    const de = document.documentElement;
    delete de.dataset.sheetLock; de.style.overflow = ''; de.style.paddingRight = ''; de.style.removeProperty('--sbw');
  }
  function inertOthers() {
    for (let n = root; n && n !== document.documentElement; n = n.parentElement)
      Array.from(n.parentElement.children).forEach(s => { if (s !== n && !s.inert && s.tagName !== 'SCRIPT') { s.inert = true; inerted.push(s); } });
  }
  function restoreInert() { inerted.splice(0).forEach(s => (s.inert = false)); }
  const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE)).filter(e => !e.closest('[inert]') && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden');
  function focusInto() {
    const t = q('[data-sheet-focus]', root) || q('[data-step]:not([inert]) [data-step-focus]', root) || panel;
    if (!t.hasAttribute('tabindex') && t === panel) panel.tabIndex = -1;
    t.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (state === 'closed') return;
    if (e.key === 'Escape') { e.preventDefault(); close('esc'); }
    else if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !panel.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !panel.contains(a))) { e.preventDefault(); first.focus(); }
    }
  }

  /* ---- открыть / закрыть ---- */
  const emit = (name, detail = {}) => root.dispatchEvent(new CustomEvent('sheet:' + name, { bubbles: true, detail }));
  const measure = () => (isMobile() ? Math.ceil(panel.getBoundingClientRect().height) + 8 : cfg.desktopTravel);

  function open(opener = null, detail = {}) {
    if (state === 'open' || state === 'opening') return;
    if (state === 'closed') {
      lastFocus = opener || document.activeElement;
      rm = prefersReducedMotion();
      root.hidden = false;
      if (!cfg.keepStep) steps.reset();
      T = measure();
      spring.setParams(cfg.open.response, cfg.open.damping);
      spring.jump(T);
      lockScroll(); inertOthers();
      document.addEventListener('keydown', onKey);
      if (!history.state?.sheet) { history.pushState({ sheet: 1 }, '', '#' + (root.id || 'zapis')); pushed = true; }
      requestAnimationFrame(focusInto);
      emit('open', { opener: opener?.dataset ?? {}, ...detail });
    }
    state = 'opening';
    // rm: только проявка (apple §14), ~0.25 с; иначе пружина «открытие»
    spring.to(0, rm ? { response: 0.1, damping: 1 } : cfg.open);
  }

  function close(reason = 'ui') {
    if (state === 'closed' || state === 'closing') return;
    state = 'closing';
    T = Math.max(T, measure());
    spring.to(T, rm ? { response: 0.1, damping: 1 } : cfg.close);
    emit('closing', { reason });
    if (pushed && reason !== 'pop' && history.state?.sheet) history.back();
    pushed = false;
  }

  function finalize() {
    state = 'closed';
    root.hidden = true;
    panel.style.transform = ''; panel.style.opacity = ''; if (scrim) scrim.style.opacity = '';
    document.removeEventListener('keydown', onKey);
    restoreInert(); unlockScroll();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    emit('close');
  }
  spring.onSettle(() => {
    if (spring.t === 0) { if (state === 'opening') { state = 'open'; emit('opened'); } }
    else if (state === 'closing') finalize();
  });

  /* ---- смахивание вниз ---- */
  const g = { y0: 0 };
  const gesture = {
    begin() {
      spring.grab(); g.y0 = spring.x;
      if (state === 'closing' || state === 'opening') state = 'open'; // схватили на лету: ведём от текущего положения
      panel.classList.add('is-grab');
    },
    move(d) { spring.set(rubberClamp(g.y0 + d, 0, T, T)); },       // 1:1 + резина вверх (0.55)
    end(v, cancelled) {
      panel.classList.remove('is-grab');
      const y = spring.x, proj = y + (cancelled ? 0 : project(v, cfg.projectionDecel));
      const shut = proj > T * 0.5;                                    // куда придёт бросок, а не где отпустили
      if (shut) { state = 'closing'; spring.to(T, { velocity: v, ...cfg.close }); emit('closing', { reason: 'swipe' }); if (pushed && history.state?.sheet) history.back(); pushed = false; }
      else { state = 'opening'; spring.to(0, { velocity: v, ...cfg.snap }); }
    },
  };
  const drags = grabs.map(el => createDrag(el, {
    axis: 'y', touchAction: 'none',
    canStart: () => isMobile() && state !== 'closed',
    onStart: () => gesture.begin(),
    onMove: m => gesture.move(m.d),
    onEnd: m => { if (m.cancelled && m.d === 0) return; gesture.end(m.v, m.cancelled); },
  }));

  // тело шторки: если оно прокручено в самый верх — потянули вниз, значит тянем шторку (touch-события: pointer-события тут отдаёт скроллу браузер)
  let tb = null;
  body.addEventListener('touchstart', e => {
    if (!isMobile() || state === 'closed' || e.touches.length !== 1) { tb = null; return; }
    const t = e.touches[0]; tb = { x: t.clientX, y: t.clientY, top: body.scrollTop <= 0, claimed: false, o: 0, trk: new VelocityTracker() };
    tb.trk.push(e.timeStamp, t.clientY);
  }, { passive: true });
  body.addEventListener('touchmove', e => {
    if (!tb) return;
    const t = e.touches[0], dy = t.clientY - tb.y, dx = t.clientX - tb.x;
    if (!tb.claimed) {
      if (tb.top && dy > THRESHOLD && dy > Math.abs(dx)) { tb.claimed = true; tb.o = t.clientY; tb.trk.reset(); gesture.begin(); }
      else { if (Math.abs(dy) > THRESHOLD || Math.abs(dx) > THRESHOLD) tb = null; return; }
    }
    if (e.cancelable) e.preventDefault();
    tb.trk.push(e.timeStamp, t.clientY);
    gesture.move(t.clientY - tb.o);
  }, { passive: false });
  const tEnd = e => { if (tb?.claimed) gesture.end(e.type === 'touchcancel' ? 0 : tb.trk.velocity(e.timeStamp), e.type === 'touchcancel'); tb = null; };
  body.addEventListener('touchend', tEnd);
  body.addEventListener('touchcancel', tEnd);

  /* ---- шаги внутри шторки: прерываемая смена, вход/уход с симметричным путём, высота на пружине ---- */
  const steps = (() => {
    const els = Array.from(root.querySelectorAll('[data-step]'));
    if (els.length < 2) return { reset() {}, go() {}, get index() { return 0; }, count: els.length };
    const wrap = els[0].parentElement;
    Object.assign(wrap.style, { display: 'grid', position: 'relative' });
    let cur = Math.max(0, els.findIndex(e => e.classList.contains('is-current')));
    const S = els.map((el, i) => {
      el.style.gridArea = '1 / 1'; el.style.alignSelf = 'start';
      const st = { el, side: 1 };
      st.sp = new Spring(i === cur ? 1 : 0, { ...cfg.step, rest: 0.002, instantOnReduced: false }, u => paint(st, u));
      st.sp.onSettle(() => { if (st.sp.t === 0) hide(st); });
      return st;
    });
    const hSp = new Spring(0, { ...cfg.height, rest: 0.1 }, h => { wrap.style.height = h + 'px'; });
    hSp.onSettle(() => { wrap.style.height = ''; wrap.style.overflow = ''; });
    function paint(st, u) {
      st.el.style.opacity = u;
      st.el.style.transform = rm || prefersReducedMotion() ? 'none' : `translate3d(${st.side * (1 - u) * cfg.stepDist}px,0,0)`;
    }
    function hide(st) { st.el.style.display = 'none'; st.el.inert = true; st.el.setAttribute('aria-hidden', 'true'); st.el.classList.remove('is-current'); }
    function show(st) { st.el.style.display = ''; st.el.inert = false; st.el.removeAttribute('aria-hidden'); }
    S.forEach((st, i) => { if (i === cur) { show(st); paint(st, 1); st.el.classList.add('is-current'); } else { hide(st); paint(st, 0); } });
    const out = prefersReducedMotion() ? { response: 0.1, damping: 1 } : cfg.stepOut;
    const inn = prefersReducedMotion() ? { response: 0.1, damping: 1 } : cfg.step;
    const api = {
      count: els.length,
      get index() { return cur; },
      reset() { S.forEach((st, i) => { st.sp.jump(i === 0 ? 1 : 0); i === 0 ? show(st) : hide(st); st.el.classList.toggle('is-current', i === 0); }); hSp.stop(); wrap.style.height = ''; wrap.style.overflow = ''; cur = 0; },
      go(i, { focus = true } = {}) {
        if (i === cur || i < 0 || i >= S.length) return;
        const dir = i > cur ? 1 : -1, from = S[cur], to = S[i];
        const h0 = hSp.active ? hSp.x : wrap.getBoundingClientRect().height;
        show(to); to.side = dir; from.side = -dir;     // вперёд: входит справа, уходит влево; назад — зеркально
        if (!to.sp.active && to.sp.x === 0) paint(to, 0);
        const h1 = to.el.offsetHeight;
        wrap.style.overflow = 'hidden'; wrap.style.height = h0 + 'px';
        hSp.x = h0; hSp.t = h0; hSp.to(h1);
        from.sp.to(0, out); to.sp.to(1, inn);
        from.el.classList.remove('is-current'); to.el.classList.add('is-current');
        cur = i;
        if (focus) { const f = q('[data-step-focus]', to.el) || to.el; if (!f.hasAttribute('tabindex')) f.tabIndex = -1; f.focus({ preventScroll: true }); }
        emit('step', { index: i, dir });
      },
    };
    return api;
  })();

  /* ---- события ---- */
  const onClick = e => {
    const op = e.target.closest?.(openers);
    if (op && !root.contains(op) && !e.defaultPrevented && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
      e.preventDefault(); open(op); return;
    }
    if (!root.contains(e.target)) return;
    if (e.target.closest('[data-sheet-close]') || e.target === scrim) { close('ui'); return; }
    const n = e.target.closest('[data-next],[data-prev],[data-goto]');
    if (n) {
      if (n.matches('[data-next]')) steps.go(steps.index + 1);
      else if (n.matches('[data-prev]')) steps.go(steps.index - 1);
      else steps.go(+n.dataset.goto);
    }
  };
  document.addEventListener('click', onClick);
  const onPop = () => { if (state === 'open' || state === 'opening') close('pop'); };
  addEventListener('popstate', onPop);

  return {
    open, close, step: steps.go, get stepIndex() { return steps.index; }, get state() { return state; }, spring,
    destroy() {
      document.removeEventListener('click', onClick); removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey); drags.forEach(d => d.destroy());
      if (state !== 'closed') finalize();
    },
  };
}
