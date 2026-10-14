/* booking.js — клиент записи для шторки #zapis (server/API.md, решение G20).
   Сайт не собирает имя и телефон и ничего не бронирует: услуга → день/слот → готовое сообщение → WhatsApp / Telegram.
   Только GET: /services, /slots. 4 секунды на любой запрос, дальше — запасной режим (сообщение без дня и времени).
   Шаги и пружины ведёт sheet.js; здесь — содержимое шагов. Базовый адрес: ?api= → <meta name="api-base"> → /api.
   Тексты — COPY.md §10 дословно. Разметка шагов — в index.html (#zapis). */

const $ = (s, c = document) => c.querySelector(s);
const root = $('#zapis');
const TIMEOUT = 4000;
const WA = '79651461738', TG = 'maryanasrp';
const T = {
  loading: 'смотрю свободные окна',
  empty: 'свободных окон пока нет. напишите мне, подберу время',
  down: 'окна сейчас не загружаются. напишите мне, текст уже готов',
  copied: 'текст скопирован, вставьте его в чат',
  copyFail: 'не получилось скопировать, выделите текст и скопируйте вручную',   // нет в COPY.md: запрос копирайтеру (см. хендоф)
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = s => `${s.priceFrom ? 'от ' : ''}${s.price.toLocaleString('ru-RU')} ₽`.replace(/\s/g, ' ');
const dur = m => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`);
const nw = s => { const i = s.title.lastIndexOf(' '), dot = s.included ? '<i class="dot" role="img" aria-label="включено"></i>' : ''; return `${esc(s.title.slice(0, i + 1))}<span class="nw">${esc(s.title.slice(i + 1))}${dot}</span>`; };
const msg = (...p) => { p = p.filter(Boolean); return `Здравствуйте, Марьяна. Хочу записаться${p.length ? ': ' + p.join(', ') : ''}.`; };

if (root) {
  let data = JSON.parse($('#services-data').textContent);
  const base = (new URLSearchParams(location.search).get('api') || $('meta[name=api-base]')?.content || '/api').replace(/\/$/, '');
  const S = { svc: null, day: null, slot: null, down: null, ctl: null, wa: `https://wa.me/${WA}`, tg: `https://t.me/${TG}` };
  const el = { svc: $('#zServices'), slots: $('#zSlots'), next: $('#zNext1'), sum2: $('#zSum2'), q3: $('#zq3'), sum3: $('#zSum3'), hint: $('#zHint'), draft: $('#zDraft'),
    wa: $('#zWa'), tg: $('#zTg'), back3: $('#zBack3'), step: $('#zStep'), bar: $('#zBar'), toast: $('#zToast'), body: $('[data-sheet-body]', root) };
  const jump = Object.assign(document.createElement('button'), { hidden: true, type: 'button' });   // программный переход шага через sheet.js (data-goto)
  root.append(jump);
  const go = i => { jump.dataset.goto = i; jump.click(); };
  const svcById = id => data.services.find(s => s.id === id);
  const sumLine = () => (S.svc ? `${S.svc.fullTitle} · ${dur(S.svc.durationMin)}` : '');

  /* ---------- шаг 1: услуги (встроенный JSON = копия server/services.json) ---------- */
  function renderServices() {
    el.svc.innerHTML = data.categories.map(c => {
      const list = data.services.filter(s => s.category === c.id);
      return list.length ? `<div><p class="sheet__grp">${esc(c.title)}</p><ul class="rows" role="radiogroup" aria-label="${esc(c.title)}">${list.map(s =>
        `<li><button class="row" type="button" role="radio" aria-checked="false" data-id="${esc(s.id)}"><span class="row__n">${nw(s)}</span><span class="row__d">${dur(s.durationMin)}</span><span class="row__p">${money(s)}</span></button></li>`).join('')}</ul></div>` : '';
    }).join('');
    mark();
  }
  function mark() {
    el.svc.querySelectorAll('.row').forEach(b => { const on = b.dataset.id === S.svc?.id; b.setAttribute('aria-checked', on); b.classList.toggle('is-selected', on); });
    el.next.disabled = !S.svc;
  }
  function select(id) { S.svc = svcById(id) || null; S.day = S.slot = null; mark(); }

  /* ---------- сеть: 4 секунды, потом запасной режим ---------- */
  async function api(path, ctl) {
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(base + path, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  async function ping() {   // «сверка» услуг; не отвечает — сразу запасной режим, без второго ожидания
    const ctl = new AbortController(); S.ping = ctl;
    try {
      const j = await api('/services', ctl);
      if (!Array.isArray(j.services) || !Array.isArray(j.categories)) throw new Error('shape');
      if (S.ping !== ctl) return;
      if (S.down === null) S.down = false;
      if (JSON.stringify(j.services) !== JSON.stringify(data.services)) { data = j; renderServices(); if (S.svc) select(S.svc.id); }
    } catch { if (S.ping === ctl && S.down === null) S.down = true; }
  }

  /* ---------- шаг 2: когда удобно ---------- */
  const contact = text => `<div class="draft">${esc(text)}</div><div class="zs__foot"><a class="btn btn--primary btn--block" target="_blank" rel="noopener" href="${esc(waLink(text))}">написать в WhatsApp</a><a class="btn btn--ghost btn--block" data-tg data-text="${esc(text)}" target="_blank" rel="noopener" href="${esc(S.tg)}">или в Telegram</a></div>`;
  const waLink = text => `${S.wa}?text=${encodeURIComponent(text)}`;
  const q2 = t => { $('#zq2').textContent = t; };
  function viewLoading() {
    q2('когда удобно?');
    el.slots.innerHTML = `<p class="sheet__status" role="status">${T.loading}</p><div class="skel" aria-hidden="true">${'<i></i>'.repeat(8)}</div>`;
  }
  function viewSlots(j) {
    q2('когда удобно?');
    el.slots.innerHTML = `<div class="days" role="group" aria-label="день">${j.dates.map((d, i) => `<button class="day" type="button" aria-pressed="${i === 0}" data-i="${i}">${esc(d.label)}</button>`).join('')}</div><div class="slots" role="group" aria-label="время"></div>`;
    S.dates = j.dates; days(0);
  }
  function days(i) {
    S.day = S.dates[i];
    el.slots.querySelectorAll('.day').forEach((b, k) => b.setAttribute('aria-pressed', k === i));
    $('.slots', el.slots).innerHTML = S.day.slots.map(s => `<button class="slot" type="button" data-goto="2" aria-pressed="false" data-time="${esc(s.time)}">${esc(s.time)}</button>`).join('');
  }
  function viewEmpty() {
    q2(T.empty);
    el.slots.innerHTML = contact(msg(S.svc?.fullTitle));
  }
  async function loadSlots() {
    const ctl = S.ctl = new AbortController();
    try {
      const j = await api(`/slots?service=${encodeURIComponent(S.svc.id)}`, ctl);
      if (S.ctl !== ctl) return;
      if (!Array.isArray(j.dates)) throw new Error('shape');
      S.down = false;
      if (j.messenger?.whatsapp) S.wa = j.messenger.whatsapp;
      if (j.messenger?.telegram) S.tg = j.messenger.telegram;
      j.empty || !j.dates.length ? viewEmpty() : viewSlots(j);
    } catch {
      if (S.ctl !== ctl || ctl.user) return;     // ушли назад / закрыли — молчим
      S.down = true; offline(); go(2);
    }
  }

  /* ---------- шаг 3: сообщение ---------- */
  function renderSend(slot) {
    const text = msg(S.svc?.fullTitle, slot && S.day.label, slot);
    el.q3.textContent = slot ? `${S.day.label}, ${slot}` : T.down;
    el.sum3.textContent = sumLine();
    el.hint.hidden = !slot;
    el.draft.textContent = text;
    el.wa.href = waLink(text);
    el.tg.href = S.tg; el.tg.dataset.text = text;
    el.back3.dataset.goto = slot ? 1 : 0;
  }
  const offline = () => renderSend(null);

  /* ---------- Telegram: копируем текст и открываем чат (ссылка идёт своим ходом, без блокировщика окон) ---------- */
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* нет доступа к буферу */ }
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0'; root.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* нет */ }
    ta.remove(); return ok;
  }
  let tt = 0;
  function toast(text, err) {
    el.toast.textContent = text; el.toast.classList.toggle('toast--error', !!err); el.toast.classList.add('is-on');
    clearTimeout(tt); tt = setTimeout(() => el.toast.classList.remove('is-on'), 4000);
  }

  /* ---------- события ---------- */
  root.addEventListener('click', e => {
    const t = e.target;
    let b;
    if ((b = t.closest('.row[data-id]'))) return select(b.dataset.id);
    if (t.closest('#zNext1')) {   // sheet.js после нас сам поедет на шаг из data-goto
      el.sum2.textContent = sumLine();
      if (S.down) { offline(); el.next.dataset.goto = 2; } else { el.next.dataset.goto = 1; S.slot = null; viewLoading(); loadSlots(); }
      return;
    }
    if ((b = t.closest('.day'))) return days(+b.dataset.i);
    if ((b = t.closest('.slot'))) { S.slot = b.dataset.time; return renderSend(S.slot); }
    if ((b = t.closest('[data-tg]'))) copy(b.dataset.text).then(ok => toast(ok ? T.copied : T.copyFail, !ok));
  });
  root.addEventListener('sheet:open', e => {
    S.down = null; S.dates = null; S.day = S.slot = null; S.svc = svcById(e.detail?.opener?.service) || null;
    mark(); ping();
    const row = el.svc.querySelector('.is-selected'); if (row) row.scrollIntoView({ block: 'nearest' });
    el.toast.classList.remove('is-on');
  });
  root.addEventListener('sheet:step', e => {
    const i = e.detail.index;
    el.step.textContent = `${i + 1} / 3`;
    el.bar.querySelectorAll('i').forEach((x, k) => x.classList.toggle('is-done', k <= i));
    el.body.scrollTop = 0;
    if (i === 0 && S.ctl) { S.ctl.user = true; S.ctl.abort(); S.ctl = null; }   // назад из загрузки
  });
  root.addEventListener('sheet:close', () => {
    if (S.ctl) { S.ctl.user = true; S.ctl.abort(); S.ctl = null; }
    if (S.ping) S.ping.abort();
    el.step.textContent = '1 / 3'; el.bar.querySelectorAll('i').forEach((x, k) => x.classList.toggle('is-done', k === 0));
  });
  renderServices();
}
