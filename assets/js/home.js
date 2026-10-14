/* home.js — главная: всё, что не движение (оно в motion/) и не запись (booking.js).
   Шапка-материал без сцены · фото цен по категории · карта по нажатию · запасной показ #zapis. Без JS страница полная. */
import './booking.js';
import { PHOTO } from './motion/scroll-scenes.js';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* шапка: материал. Когда сцена hero жива, класс ведёт она (scroll-scenes.js); при reduced-motion и без GSAP — по скроллу */
const nav = $('#nav');
if (nav) {
  const upd = () => { if (!window.ScrollTrigger || rm) nav.classList.toggle('is-material', scrollY > 8); };
  addEventListener('scroll', upd, { passive: true });
  upd();
}

/* карта: iframe не грузится, пока не нажали (принцип надёжности GRILL) */
const map = $('#map'), mapBtn = $('#mapBtn');
mapBtn?.addEventListener('click', () => {
  const f = document.createElement('iframe');
  Object.assign(f, { src: map.dataset.src, title: 'карта: 1-я Миусская, 22с3', loading: 'lazy', referrerPolicy: 'no-referrer' });
  map.replaceChildren(f);
});

/* если шторка не собралась (модуль не загрузился), «записаться» ведёт к обычной секции со ссылками в мессенджеры */
setTimeout(() => { const z = $('#zapis'); if (z && !z.classList.contains('is-sheet')) document.documentElement.classList.add('zapis-fallback'); }, 8000);

/* плавающая «записаться» прячется, когда в окне подвал (у подвала своя кнопка) */
const foot = $('.foot');
if (foot && 'IntersectionObserver' in window) new IntersectionObserver(es => document.documentElement.classList.toggle('foot-in', es[0].isIntersecting), { rootMargin: '0px 0px -10% 0px' }).observe(foot);

/* вход в кейс по числам rhode: кадр 1.2 → 1.0, от top 65 % окна до закрепления; ждём, пока сцены подтянут GSAP */
if (!rm) {
  const t0 = setInterval(() => {
    const { gsap, ScrollTrigger: ST } = window;
    if (!gsap || !ST || !document.documentElement.classList.contains('case-live')) return;
    clearInterval(t0);
    gsap.fromTo('.case__zoom', { scale: PHOTO.from }, { scale: PHOTO.to, ease: t => 1 - Math.pow(1 - t, PHOTO.easeN), scrollTrigger: { trigger: '#noska', start: PHOTO.start, end: 'top top', scrub: true } });
  }, 250);
  setTimeout(() => clearInterval(t0), 15000);
}

/* фото бровей: ширина задана (≈6 колонок, не меньше 640 px, не выше окна), верх = верх первой строки, низ = низ последней;
   высота списка подгоняется вертикальными отступами строк. На ≤1199 не применяется */
const fitCat = $('.cat[data-k="brows"]');
if (fitCat) {
  const mq = matchMedia('(min-width: 1200px)');
  const fit = () => {
    fitCat.classList.toggle('cat--fit', mq.matches);
    ['--pw', '--pt', '--rp'].forEach(v => fitCat.style.removeProperty(v));
    if (!mq.matches) return;
    const ul = $('.rows', fitCat), b = $('.cat__b', fitCat), n = $$('.row', ul).length;
    const g = 24, six = fitCat.clientWidth / 2 - g / 2;
    const W = Math.round(Math.max(640, Math.min(six, 0.8 * (innerHeight - 60))));
    fitCat.style.setProperty('--pw', W + 'px');
    fitCat.style.setProperty('--rp', '0px');
    const h0 = ul.getBoundingClientRect().height, H = W * 1.25;
    const rp = Math.max(12, (H - h0) / (2 * n));
    fitCat.style.setProperty('--rp', rp.toFixed(1) + 'px');
    fitCat.style.setProperty('--pt', Math.round(ul.getBoundingClientRect().top - b.getBoundingClientRect().top) + 'px');
  };
  fit(); mq.addEventListener('change', fit); addEventListener('resize', fit);
  document.fonts?.ready.then(fit);
}
