/* dev-grid.js — оверлей сетки по клавише G. Работает только при ?grid в адресе или <html data-dev>.
   В боевую сборку не подключать. Разметка: <div class="gridlay" id="gridlay"><div class="grid"><i></i>×12</div></div> */
(function () {
  var dev = /[?&]grid\b/.test(location.search) || document.documentElement.hasAttribute('data-dev');
  if (!dev) return;
  var lay = document.getElementById('gridlay');
  if (!lay) return;
  addEventListener('keydown', function (e) {
    if (e.key !== 'g' && e.key !== 'G' && e.key !== 'п' && e.key !== 'П') return;      // п — та же клавиша на русской раскладке
    if (/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')) return;
    lay.classList.toggle('is-on');
  });
  if (/[?&]grid=on\b/.test(location.search)) lay.classList.add('is-on');
})();
