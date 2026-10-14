/* scroll-scenes.js — сценарное движение на GSAP + ScrollTrigger (G8, закон П12)
   Сцены: hero «кадр открывается» · кейс Миры по неделям · фото-скейл rhode.
   Принцип: СКРОЛЛ задаёт цель, ПРУЖИНА ведёт (spring.js). Поэтому всё прерываемо и не дёргается от колеса.
   Загрузка: GSAP+ScrollTrigger (≈45,7 КБ gzip) подтягиваются ЛЕНИВО, после load + idle (после LCP).
   Без JS / без GSAP / reduced-motion: сцены не включаются, вся страница статична и видна целиком. */

import { Spring, clamp, prefersReducedMotion } from './spring.js';

/* ---------- параметры (всё, что крутится ползунками пробника) ---------- */
export const HERO = {
  scroll: { response: 0.55, damping: 1 },   // пружина раскрытия от скролла
  pin: '+=110%',                            // сцена закреплена на 110 % высоты окна
  scale: [1.18, 1],                         // фото внутри кадра
  marks: { response: 0.6, damping: 1 },     // появление миллиметровки и меток после входа
  strip: { top: [0.17, 0.18], bottom: [0.53, 0.48] }, // [десктоп, мобайл] — ДОЛЖНО совпадать с CSS-состоянием «полоса»
};
export const CASE = {
  spring: { response: 0.5, damping: 1 },
  perFrame: 0.75,                           // высоты окна скролла на один переход
  grow: 0.08,                               // входящий кадр: scale 1.08 → 1
};
export const PHOTO = {
  from: 1.2, to: 1,
  start: 'top 65%', end: 'bottom top',      // rhode: старт при верхе фото на 65 % окна, финиш — низ фото у верха
  easeN: 1.25,                              // t → 1−(1−t)^n. n=2 это power1.out из лока; ЗАМЕР rhode даёт ≈1.25 (RMSE 0.006 против 0.025) — см. MOTION-SPEC §7
  priceFrom: 0.94,
};

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const NS = 'http://www.w3.org/2000/svg';

/* ---------- ленивый старт ---------- */
/** после LCP: событие load (hero-фото загружено и отрисовано) + простой главного потока */
export function afterLCP(timeout = 2500) {
  return new Promise(res => {
    const go = () => ('requestIdleCallback' in window ? requestIdleCallback(() => res(), { timeout }) : setTimeout(res, 200));
    document.readyState === 'complete' ? go() : addEventListener('load', go, { once: true });
  });
}

let vendorPromise = null;
/** подгружает gsap.min.js, затем ScrollTrigger.min.js (по порядку), один раз */
export function loadGsap(base = '/assets/vendor/') {
  if (window.gsap && window.ScrollTrigger) return Promise.resolve();
  if (vendorPromise) return vendorPromise;
  const add = src => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = base + src; s.async = false; s.onload = ok; s.onerror = () => fail(new Error('не загрузился ' + src));
    document.head.appendChild(s);
  });
  vendorPromise = add('gsap.min.js').then(() => add('ScrollTrigger.min.js'));
  return vendorPromise;
}

/** gsap.ticker не крутится вхолостую: спит, пока нет скролла/ресайза/касания; просыпается на событие, засыпает через 400 мс тишины */
function tickerGovernor(gsap) {
  let t = 0;
  const sleep = () => gsap.ticker.sleep();
  const wake = () => { gsap.ticker.wake(); clearTimeout(t); t = setTimeout(sleep, 400); };
  const ev = ['scroll', 'resize', 'orientationchange', 'pointerdown', 'keydown', 'visibilitychange', 'load'];
  ev.forEach(e => addEventListener(e, wake, { passive: true }));
  wake();
  return { destroy() { ev.forEach(e => removeEventListener(e, wake)); clearTimeout(t); gsap.ticker.wake(); } };
}

/* =========================================================
   HERO — «кадр открывается»
   Вход (линия → полоса-видоискатель) отыгрывает ЧИСТЫЙ CSS по ζ/response (см. MOTION-SPEC §3, linear()), чтобы
   LCP-кадр не ждал JS. Эта сцена принимает управление после входа и отдаёт скролл → пружине.
   ========================================================= */
export function heroScene(gsap, ST, cfg = HERO) {
  const stage = $('#hero .hero__stage'), frame = $('#heroFrame'), img = $('#heroImg');
  const marks = $('#heroMarks'), ruler = $('#heroRuler'), A = $('#heroA'), card = $('#heroCard');
  if (!stage || !frame || !img) return null;
  const nav = $('#nav');
  let G = {}, mk = null;
  const S = { p: 0, m: 0 };

  function geom() {
    const W = stage.clientWidth, H = stage.clientHeight, mob = W < 768;
    // боковое поле сетки: CSS-переменная --gm (контракт), иначе padding .grid; JS и CSS-состояние «полоса» обязаны совпадать
    const gm = parseFloat(getComputedStyle(stage).getPropertyValue('--gm')) || parseFloat(getComputedStyle($('.grid') || stage).paddingLeft) || 16;
    G = { W, H, gm, T0: H * cfg.strip.top[mob ? 1 : 0], B0: H * cfg.strip.bottom[mob ? 1 : 0] };
    if (ruler) { // миллиметровка: шаг 6 px (5 на мобайле), каждая 5-я и 10-я длиннее — графика кодом, статичная
      ruler.innerHTML = '';
      const g = document.createElementNS(NS, 'g'); g.id = 'rg';
      const step = mob ? 5 : 6;
      for (let x = gm, i = 0; x <= W - gm + 0.1; x += step, i++) {
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', 0); l.setAttribute('y2', i % 10 === 0 ? 14 : i % 5 === 0 ? 9 : 5);
        g.appendChild(l);
      }
      ruler.appendChild(g);
    }
    if (marks) { marks.innerHTML = '<path id="mk"/>'; mk = $('#mk', marks); }
  }

  function render() {
    const { W, H, gm, T0, B0 } = G, p = S.p, m = S.m;
    const c = (T0 + (H - B0)) / 2, half = ((H - B0) - T0) / 2;
    const k = 1 - p;
    const top = (c - half) * k, bot = (H - (c + half)) * k, side = gm * k;
    frame.style.clipPath = `inset(${top}px ${side}px ${bot}px ${side}px round ${8 * k}px)`;   // углы 8 px, к открытому кадру сходят на 0
    img.style.transform = `scale(${cfg.scale[0] - (cfg.scale[0] - cfg.scale[1]) * p})`;
    if (mk) {
      const L = 16, x0 = side - 8, x1 = W - side + 8, y0 = top - 8, y1 = H - bot + 8;
      mk.setAttribute('d', `M${x0} ${y0 + L}V${y0}H${x0 + L}M${x1 - L} ${y0}H${x1}V${y0 + L}M${x1} ${y1 - L}V${y1}H${x1 - L}M${x0 + L} ${y1}H${x0}V${y1 - L}`);
      marks.style.opacity = m * clamp(1 - p * 1.6);
    }
    if (ruler) {
      $('#rg', ruler)?.setAttribute('transform', `translate(0 ${H - bot + 14})`);
      ruler.style.opacity = m * clamp(1 - p * 3);
    }
    if (A) {
      A.style.opacity = clamp(1 - p * 2.4);
      A.style.transform = `translateY(${-p * 48}px)`;
      A.style.pointerEvents = p > 0.4 ? 'none' : '';
    }
    if (card) {
      const co = clamp((p - 0.62) / 0.3);
      card.style.opacity = co; card.style.visibility = co > 0.01 ? 'visible' : 'hidden';
      card.style.transform = `translateY(${(1 - co) * 16}px)`;
      card.setAttribute('aria-hidden', co > 0.5 ? 'false' : 'true');
      const a = $('a', card); if (a) a.tabIndex = co > 0.5 ? 0 : -1;
    }
    if (nav) nav.classList.toggle('is-material', p > 0.3 || scrollY > innerHeight * 1.2);
    document.dispatchEvent(new CustomEvent('hero:progress', { detail: p }));
  }

  const sp = new Spring(0, cfg.scroll, v => { S.p = v; render(); });
  const mSp = new Spring(0, cfg.marks, v => { S.m = v; render(); });
  geom(); render();

  // принять управление после CSS-входа: Animation.finished (fill обязан быть backwards, а не forwards/both)
  let alive = true;
  const css = frame.getAnimations?.() ?? [];
  Promise.allSettled(css.map(a => a.finished)).then(() => {
    if (!alive) return;
    css.forEach(a => { try { a.cancel(); } catch (_) { /* уже снята */ } });
    render(); mSp.to(1);
  });

  const trig = ST.create({
    trigger: '#hero', start: 'top top', end: cfg.pin, pin: true, pinSpacing: true,
    onUpdate: s => sp.to(s.progress),
    onRefresh: s => sp.jump(s.progress),
    onToggle: s => { frame.style.willChange = s.isActive ? 'clip-path' : ''; img.style.willChange = s.isActive ? 'transform' : ''; },
  });
  let rt = 0;
  const onResize = () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { geom(); render(); }); };
  addEventListener('resize', onResize);

  return {
    spring: sp, trigger: trig,
    destroy() {
      alive = false; trig.kill(true); sp.stop(); mSp.stop(); removeEventListener('resize', onResize);
      [frame.style, img.style].forEach(s => { s.clipPath = ''; s.transform = ''; s.willChange = ''; });
      [A, card, marks, ruler].forEach(e => e && (e.removeAttribute('style')));
    },
  };
}

/* =========================================================
   КЕЙС МИРЫ — пять кадров, совмещённых по зрачку; скролл листает, кольца — прогресс и касание
   Фон светлый (лок): сцена меняет только opacity/scale кадров и подписей.
   ========================================================= */
export function caseScene(gsap, ST, cfg = CASE) {
  const sec = $('#noska');
  const cfs = $$('.cf'), caps = $$('.cap'), rings = $$('#rings button');
  if (!sec || cfs.length < 2) return null;
  const N = cfs.length, count = $('#caseCount');
  const root = document.documentElement;

  // кадры в стопке разогреваем заранее: ленивая загрузка и декодирование посреди скролла дают длинные кадры
  cfs.forEach(f => { const im = $('img', f); if (im) { im.loading = 'eager'; im.decode?.().catch(() => {}); } });
  const lastA = new Array(cfs.length).fill(-1);
  function render(q) {
    cfs.forEach((f, i) => {
      const a = i === 0 ? 1 : clamp(q - (i - 1));
      if (a === lastA[i]) return;          // кадр не менялся — не трогаем стиль (экономим пересчёт)
      lastA[i] = a;
      f.style.opacity = a;
      const im = $('img', f); if (im) im.style.transform = `scale(${i === 0 ? 1 : 1 + cfg.grow * (1 - a)})`;
    });
    caps.forEach((c, i) => {
      const o = clamp(1 - Math.abs(q - i) * 2.2);
      c.style.opacity = o; c.style.transform = `translateY(${(q - i) * -10}px)`;
      c.style.visibility = o > 0.01 ? 'visible' : 'hidden';
    });
    const on = Math.round(q);
    rings.forEach((r, i) => {
      const c = $('circle', r); if (c) c.style.strokeDashoffset = 176 * (1 - (i === 0 ? 1 : clamp(q - (i - 1))));
      r.classList.toggle('is-on', i === on);
      r.setAttribute('aria-current', i === on ? 'step' : 'false');
    });
    if (count) count.textContent = `0${on + 1} / 0${N}`;
  }
  const sp = new Spring(0, cfg.spring, render);
  root.classList.add('case-live');
  render(0);
  const trig = ST.create({
    trigger: sec, start: 'top top', end: () => '+=' + innerHeight * cfg.perFrame * (N - 1), pin: true, pinSpacing: true,
    onUpdate: s => sp.to(s.progress * (N - 1)),
    onRefresh: s => sp.jump(s.progress * (N - 1)),
    onToggle: s => { cfs.forEach(f => (f.style.willChange = s.isActive ? 'opacity' : '')); root.classList.toggle('case-pin', s.isActive); },
  });
  const onRing = rings.map((r, i) => {
    const fn = () => scrollTo({ top: trig.start + (trig.end - trig.start) * (i / (N - 1)), behavior: 'smooth' });
    r.addEventListener('click', fn); return fn;
  });
  return {
    spring: sp, trigger: trig,
    destroy() {
      trig.kill(true); sp.stop(); root.classList.remove('case-live');
      rings.forEach((r, i) => r.removeEventListener('click', onRing[i]));
      cfs.forEach(f => { f.removeAttribute('style'); const im = $('img', f); im && im.removeAttribute('style'); });
      caps.forEach(c => c.removeAttribute('style'));
    },
  };
}

/* =========================================================
   ФОТО ПРИ СКРОЛЛЕ — числа rhode: scale 1.2 → 1.0, scrub, start top 65 %, end bottom top
   ========================================================= */
export function photoScenes(gsap, ST, cfg = PHOTO) {
  const out = [];
  const ease = t => 1 - Math.pow(1 - t, cfg.easeN);
  const targets = $$('[data-photo-scale] img, .shutter img');
  const wraps = new Map();
  targets.forEach(im => { const w = im.closest('[data-photo-scale], .shutter'); (wraps.get(w) ?? wraps.set(w, []).get(w)).push(im); });
  wraps.forEach((imgs, w) => {
    const tw = gsap.fromTo(imgs, { scale: cfg.from }, {
      scale: cfg.to, ease, scrollTrigger: { trigger: w, start: cfg.start, end: cfg.end, scrub: true,
        onToggle: s => imgs.forEach(i => (i.style.willChange = s.isActive ? 'transform' : '')) },
    });
    out.push(tw);
  });
  const pm = $('#pm'), prices = $('.prices');
  if (pm && prices) out.push(gsap.fromTo(pm, { scale: cfg.priceFrom }, { scale: 1, ease, scrollTrigger: { trigger: prices, start: cfg.start, end: 'top top', scrub: true } }));
  return {
    count: out.length,
    destroy() { out.forEach(t => { t.scrollTrigger?.kill(); t.kill(); }); targets.forEach(i => { i.style.transform = ''; i.style.willChange = ''; }); if (pm) pm.style.transform = ''; },
  };
}

/* =========================================================
   Оркестратор
   ========================================================= */
/**
 * @param {{vendorBase?:string, hero?:boolean, kase?:boolean, photos?:boolean, immediate?:boolean}} o
 * @returns {Promise<{mode:'static'|'live', destroy():void, scenes:object}>}
 */
export async function initScenes(o = {}) {
  const o2 = { hero: true, kase: true, photos: true, ...o };
  if (prefersReducedMotion()) return { mode: 'static', scenes: {}, destroy() {} };
  if (!o2.immediate) await afterLCP();
  try { await loadGsap(o2.vendorBase); } catch (e) { console.warn('[motion] GSAP не загрузился, страница остаётся статичной', e); return { mode: 'static', scenes: {}, destroy() {} }; }
  const { gsap, ScrollTrigger: ST } = window;
  gsap.registerPlugin(ST);
  ST.config({ ignoreMobileResize: true });
  gsap.ticker.lagSmoothing(0);
  const scenes = {};
  if (o2.hero) scenes.hero = heroScene(gsap, ST);
  if (o2.kase) scenes.case = caseScene(gsap, ST);
  if (o2.photos) scenes.photos = photoScenes(gsap, ST);
  const gov = tickerGovernor(gsap);
  document.fonts?.ready.then(() => ST.refresh());
  return {
    mode: 'live', scenes,
    destroy() { Object.values(scenes).forEach(s => s?.destroy()); gov.destroy(); ST.refresh(); },
  };
}
