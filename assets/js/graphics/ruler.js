/* graphics/ruler.js — графика кадра: миллиметровка и метки кадра. ЧИСТЫЕ функции: данные на входе, строка/массив на выходе.
   Ни DOM, ни window, ни таймеров — можно вызвать и в браузере, и в node (проверка), и из GSAP-сцены на каждом кадре.
   Подключение без сборщика: <script src="assets/js/graphics/ruler.js"></script> → window.PDGraphics.
   В ES-модуле / node: require('./ruler.js') даёт тот же объект.
   Стили — components.css: .ruler, .marks. Цвета в JS не задаются. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PDGraphics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var r2 = function (n) { return Math.round(n * 100) / 100; };

  /* Миллиметровка: штрихи с шагом step; каждый 5-й длиннее, каждый 10-й — ещё длиннее («по волоску» буквально).
     opts: { x0, x1, step=6, lens=[5,9,14], every=[5,10] }
     → { lines:[{x, len, kind:'minor'|'mid'|'major'}], height, svg:'<line …/>…' (содержимое для <g> или <svg>) } */
  function ruler(opts) {
    opts = opts || {};
    var x0 = +opts.x0 || 0, x1 = +opts.x1, step = +opts.step || 6;
    var lens = opts.lens || [5, 9, 14], every = opts.every || [5, 10];
    if (!(x1 > x0) || !(step > 0)) return { lines: [], height: 0, svg: '' };
    var lines = [], svg = '';
    for (var x = x0, i = 0; x <= x1 + 0.1; x = x0 + (++i) * step) {   // индекс, не накопление: без дрейфа float
      var kind = i % every[1] === 0 ? 'major' : i % every[0] === 0 ? 'mid' : 'minor';
      var len = kind === 'major' ? lens[2] : kind === 'mid' ? lens[1] : lens[0];
      lines.push({ x: r2(x), len: len, kind: kind });
      svg += '<line x1="' + r2(x) + '" x2="' + r2(x) + '" y1="0" y2="' + len + '"/>';
    }
    return { lines: lines, height: lens[2], svg: svg };
  }

  /* Готовый <svg> строкой: ширина W, поля gm по бокам. Для статичной миллиметровки без JS-сцены. */
  function rulerSvg(width, gm, step) {
    var o = ruler({ x0: gm, x1: width - gm, step: step || 6 });
    return '<svg class="ruler" aria-hidden="true" viewBox="0 0 ' + width + ' ' + o.height + '" width="' + width + '" height="' + o.height + '" preserveAspectRatio="none">' + o.svg + '</svg>';
  }

  /* Метки кадра: четыре уголка вокруг прямоугольника. rect: { x0, y0, x1, y1 }, L — длина уголка, pad — вынос наружу.
     → строка для атрибута d элемента <path> (класс .marks) */
  function frameMarks(rect, L, pad) {
    L = L == null ? 16 : L; pad = pad == null ? 8 : pad;
    var x0 = rect.x0 - pad, y0 = rect.y0 - pad, x1 = rect.x1 + pad, y1 = rect.y1 + pad;
    return 'M' + r2(x0) + ' ' + r2(y0 + L) + 'V' + r2(y0) + 'H' + r2(x0 + L) +
           'M' + r2(x1 - L) + ' ' + r2(y0) + 'H' + r2(x1) + 'V' + r2(y0 + L) +
           'M' + r2(x1) + ' ' + r2(y1 - L) + 'V' + r2(y1) + 'H' + r2(x1 - L) +
           'M' + r2(x0 + L) + ' ' + r2(y1) + 'H' + r2(x0) + 'V' + r2(y1 - L);
  }

  /* Метки в процентах внутри блока (viewBox 0 0 100 100, vector-effect non-scaling-stroke) — для фото кейса и прайса. */
  function frameMarksPct(inset) {
    var a = inset == null ? 6 : inset, b = 100 - a;
    return 'M0 ' + a + 'V0H' + a + 'M' + b + ' 0H100V' + a + 'M100 ' + b + 'V100H' + b + 'M' + a + ' 100H0V' + b;
  }

  return { ruler: ruler, rulerSvg: rulerSvg, frameMarks: frameMarks, frameMarksPct: frameMarksPct };
});
