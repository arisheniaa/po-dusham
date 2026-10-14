/* init.js — точка входа слоя движения: <script type="module" src="assets/js/motion/init.js" defer></script>
   Ничего не делает до LCP. Без JS и при reduced-motion страница остаётся статичной и полностью видимой.
   Порядок после load + idle: проявки → шторки до/после → сцены GSAP (ленивый вендор) → шторка записи (лениво). */

import { afterLCP, initScenes } from './scroll-scenes.js';
import { prefersReducedMotion } from './spring.js';

const BASE = new URL('../../vendor/', import.meta.url).href;   // assets/vendor/ относительно модуля

afterLCP().then(async () => {
  // шторка до/после и проявки живут и при reduced-motion (жест и клавиши — реакция; проявка сама выключится)
  const [{ reveal, revealPhotos }, { initShutters }] = await Promise.all([import('./reveal.js'), import('./shutter.js')]);
  reveal('.h2, .cat__t, .quote, [data-reveal]');
  revealPhotos('.shutter img, [data-photo]');
  initShutters();

  if (!prefersReducedMotion()) initScenes({ vendorBase: BASE, immediate: true });

  // шторка записи: на idle; а если пользователь успел нажать «записаться» раньше — открыть сразу после загрузки
  const root = document.getElementById('zapis');
  if (root) {
    let pending = null;
    const early = e => { const b = e.target.closest?.('[data-book]'); if (b && !root.classList.contains('is-sheet')) { e.preventDefault(); pending = b; } };
    document.addEventListener('click', early, true);
    const { createSheet } = await import('./sheet.js');
    document.removeEventListener('click', early, true);
    const sheet = createSheet(root);
    if (pending) sheet.open(pending);
  }
});
