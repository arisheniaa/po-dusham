/* reveal.js — «проявка блоком» (замена побуквенному тексту, DIRECTION-LOCK)
   opacity 0→1 + сдвиг 16 px, power2.out ≈ cubic-bezier(.215,.61,.355,1), 1 с, шаг 0.12 с.
   Без GSAP: IntersectionObserver + WAAPI (0 КБ вендора).
   Без JS / reduced-motion / видимое при старте → контент не скрывается вовсе:
   скрытие ставит только JS, только блокам НИЖЕ первого экрана, только после LCP. */

import { prefersReducedMotion } from './spring.js';

export const REVEAL = {
  y: 16,                                   // 14–18 px по локу
  duration: 1000,                          // мс
  stagger: 120,                            // мс между блоками одной волны
  easing: 'cubic-bezier(.215,.61,.355,1)', // power2.out
  rootMargin: '0px 0px -15% 0px',          // ≈ start: 'top 85%'
};
export const PHOTO_FADE = { duration: 300, delay: 150, easing: 'ease-out' }; // rhode: opacity .3s ease-out .15s

const belowFold = el => el.getBoundingClientRect().top > innerHeight * 0.92;
const capable = () => !prefersReducedMotion() && 'IntersectionObserver' in window && 'animate' in Element.prototype;

function observe(items, frames, optsFn, rootMargin) {
  const done = new WeakSet();
  const io = new IntersectionObserver(es => {
    const vis = es
      .filter(e => e.isIntersecting && !done.has(e.target))
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    vis.forEach((e, i) => {
      const el = e.target; done.add(el); io.unobserve(el);
      const { duration, delay, easing } = optsFn(i);
      const moves = 'transform' in frames[0];   // фото двигает GSAP — его transform не трогаем
      el.style.willChange = moves ? 'opacity, transform' : 'opacity';
      const a = el.animate(frames, { duration, delay, easing, fill: 'both' });
      const fin = () => { el.style.opacity = ''; if (moves) el.style.transform = ''; el.style.willChange = ''; a.cancel(); };
      a.finished.then(fin, fin);
    });
  }, { rootMargin });
  items.forEach(el => io.observe(el));
  return io;
}

/**
 * Проявка блоков.
 * @param {string|Element[]} targets  селектор или список
 * @param {Partial<typeof REVEAL>} o
 * @returns {{destroy():void, count:number}}
 */
export function reveal(targets = '[data-reveal]', o = {}) {
  const cfg = { ...REVEAL, ...o };
  if (!capable()) return { destroy() {}, count: 0 };
  const list = (typeof targets === 'string' ? Array.from(document.querySelectorAll(targets)) : targets).filter(belowFold);
  const from = `translate3d(0,${cfg.y}px,0)`;
  list.forEach(el => { el.style.opacity = '0'; el.style.transform = from; });
  const io = observe(
    list,
    [{ opacity: 0, transform: from }, { opacity: 1, transform: 'translate3d(0,0,0)' }],
    i => ({ duration: cfg.duration, delay: i * cfg.stagger, easing: cfg.easing }),
    cfg.rootMargin,
  );
  const showAll = () => { io.disconnect(); list.forEach(el => { el.style.opacity = ''; el.style.transform = ''; }); };
  addEventListener('beforeprint', showAll);
  return { count: list.length, destroy() { showAll(); removeEventListener('beforeprint', showAll); } };
}

/** проявка фото как у rhode: только opacity, 0.3 с ease-out, задержка 0.15 с */
export function revealPhotos(targets = '[data-photo]', o = {}) {
  const cfg = { ...PHOTO_FADE, ...o };
  if (!capable()) return { destroy() {}, count: 0 };
  const list = (typeof targets === 'string' ? Array.from(document.querySelectorAll(targets)) : targets).filter(belowFold);
  list.forEach(el => { el.style.opacity = '0'; });
  const io = observe(list, [{ opacity: 0 }, { opacity: 1 }], () => cfg, '0px 0px -10% 0px');
  return { count: list.length, destroy() { io.disconnect(); list.forEach(el => { el.style.opacity = ''; }); } };
}
