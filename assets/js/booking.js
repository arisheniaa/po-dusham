/* booking.js — клиент записи для шторки #zapis (server/API.md).
   Два режима. «messenger» (G20): сайт не собирает имя и телефон, услуга → день/слот → готовое сообщение → WhatsApp / Telegram.
   «auto» (G28): услуга → слот → имя, телефон, отдельное согласие → POST /bookings → «вы записаны».
   Режим: ответ сервера (mode) → <meta name="booking-mode">. 4 секунды на любой запрос, дальше — запасной режим (сообщение без дня и времени).
   Демо (?demo или *.github.io): окна и бронь считаются в браузере, переключатель режимов виден в шторке.
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
const DEMO = new URLSearchParams(location.search).has('demo') || location.hostname.endsWith('github.io');
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватное окно */ } } };
const phoneNorm = v => { let d = String(v).replace(/[\s()\-]/g, ''); if (!/^\+?\d+$/.test(d)) return null; d = d.replace(/^\+/, ''); if (d.length === 10 && d[0] === '9') d = '7' + d; if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); return /^7\d{10}$/.test(d) ? '+' + d : null; };
const nameOk = v => /^[\p{L}][\p{L} \-]{0,59}$/u.test(v.trim());

/* ---------- демо-сервер: окна на 10 дней, пара занятых промежутков, брони — в localStorage этого браузера ---------- */
const demo = (() => {
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const label = d => `${d.toLocaleDateString('ru-RU', { weekday: 'short' })}, ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
  const hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const WIN = [[11 * 60, 18 * 60], [12 * 60, 20 * 60], null, [10 * 60, 16 * 60], [13 * 60, 20 * 60], null, [11 * 60, 19 * 60]];
  const BUSY = { 0: [[13 * 60, 14 * 60 + 15]], 3: [[11 * 60, 12 * 60]], 4: [[15 * 60, 17 * 60]] };
  const taken = () => store.get('pd-demo-bookings') || [];
  function slots(svc) {
    const now = new Date(), dates = [];
    for (let k = 0; k < 10; k++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k), w = WIN[k % 7];
      if (!w) continue;
      const busy = [...(BUSY[k] || []), ...taken().filter(b => b.date === iso(d)).map(b => [b.min, b.min + b.dur])];
      const out = [];
      for (let m = w[0]; m + svc.durationMin <= w[1]; m += 15) {
        const t = new Date(d); t.setMinutes(m);
        if (t - now < 3600e3) continue;
        if (busy.some(([a, b]) => m < b + 15 && m + svc.durationMin > a - 15)) continue;
        out.push({ time: hm(m) });
      }
      if (out.length) dates.push({ date: iso(d), label: label(d), slots: out });
    }
    return { dates, empty: !dates.length };
  }
  function book(svc, date, time) {
    const [h, m] = time.split(':').map(Number), list = taken();
    if (!slots(svc).dates.find(d => d.date === date)?.slots.some(s => s.time === time)) return 409;
    list.push({ date, min: h * 60 + m, dur: svc.durationMin }); store.set('pd-demo-bookings', list);
    return 201;
  }
  return { slots, book };
})();

const msg = (...p) => { p = p.filter(Boolean); return `Здравствуйте, Марьяна. Хочу записаться${p.length ? ': ' + p.join(', ') : ''}.`; };

if (root) {
  let data = JSON.parse($('#services-data').textContent);
  const base = (new URLSearchParams(location.search).get('api') || $('meta[name=api-base]')?.content || '/api').replace(/\/$/, '');
  let MODE = $('meta[name=booking-mode]')?.content === 'auto' ? 'auto' : 'messenger';
  if (DEMO) MODE = new URLSearchParams(location.search).get('mode') || store.get('pd-demo-mode') || MODE;
  const S = { svc: null, day: null, slot: null, down: null, ctl: null, wa: `https://wa.me/${WA}`, tg: `https://t.me/${TG}` };
  const el = { svc: $('#zServices'), slots: $('#zSlots'), next: $('#zNext1'), sum2: $('#zSum2'), q3: $('#zq3'), sum3: $('#zSum3'), hint: $('#zHint'), draft: $('#zDraft'),
    wa: $('#zWa'), tg: $('#zTg'), back3: $('#zBack3'), step: $('#zStep'), bar: $('#zBar'), toast: $('#zToast'), msg: $('#zMsg'), form: $('#zForm'), done: $('#zDone'), modeBox: $('#zMode'), submit: $('#zSubmit'), body: $('[data-sheet-body]', root) };
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
    if (DEMO) {
      await new Promise(r => setTimeout(r, 450));
      if (ctl.signal.aborted) throw new Error('abort');
      return path.startsWith('/slots') ? demo.slots(S.svc) : data;
    }
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
      if (j.consentVersion) S.consentVersion = j.consentVersion;
      if (!DEMO && (j.mode === 'auto' || j.mode === 'messenger')) setMode(j.mode);
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
      if (j.consentVersion) S.consentVersion = j.consentVersion;
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
    const form = MODE === 'auto' && !!slot;
    el.msg.hidden = form; el.form.hidden = !form; el.done.hidden = true; el.back3.hidden = false;
    clearErr();
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

  /* ---------- режим (в демо — переключатель в шторке) ---------- */
  function setMode(m) {
    MODE = m === 'auto' ? 'auto' : 'messenger';
    el.modeBox.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === MODE));
    document.querySelectorAll('[data-auto-only]').forEach(x => { x.hidden = MODE !== 'auto'; });
    if (DEMO) store.set('pd-demo-mode', MODE);
    if (S.slot && el.done.hidden) renderSend(S.slot);
  }

  /* ---------- автобронь: проверка и отправка ---------- */
  const inputs = { name: $('#zName'), phone: $('#zPhone'), consent: $('#zConsent') };
  const errs = { name: $('#zNameErr'), phone: $('#zPhoneErr'), consent: $('#zConsentErr') };
  function clearErr() { Object.keys(errs).forEach(k => { errs[k].hidden = true; inputs[k].removeAttribute('aria-invalid'); }); }
  function err(k) { errs[k].hidden = false; inputs[k].setAttribute('aria-invalid', 'true'); }
  async function post(body) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(base + '/bookings', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      return r.status;
    } finally { clearTimeout(timer); }
  }
  async function submit() {
    clearErr();
    const f = el.form.elements, phone = phoneNorm(f.phone.value), bad = [];
    if (!nameOk(f.name.value)) bad.push('name');
    if (!phone) bad.push('phone');
    if (!f.consent.checked) bad.push('consent');
    bad.forEach(err);
    if (bad.length) return inputs[bad[0]].focus();
    el.submit.disabled = true; el.submit.textContent = 'записываю';
    let status = 0;
    try {
      if (DEMO) { await new Promise(r => setTimeout(r, 600)); status = demo.book(S.svc, S.day.date, S.slot); }
      else status = await post({ service: S.svc.id, date: S.day.date, time: S.slot, name: f.name.value.trim(), phone, consent: true, consentVersion: S.consentVersion, website: f.website.value });
    } catch { status = 0; }
    el.submit.disabled = false; el.submit.textContent = 'записаться';
    if (status === 201) {
      el.q3.textContent = 'вы записаны';
      el.sum3.textContent = `${S.day.label}, ${S.slot} · ${sumLine()}`;
      el.form.hidden = true; el.done.hidden = false; el.back3.hidden = true; el.form.reset();
      $('#zDoneWa').href = waLink(`Здравствуйте, Марьяна. Я записана на ${S.svc.fullTitle}, ${S.day.label}, ${S.slot}.`);
      el.q3.focus();
    } else if (status === 409) {
      toast('это время только что заняли. выберите другое', true);
      S.slot = null; viewLoading(); loadSlots(); go(1);
    } else if (status >= 400 && status < 500) {
      toast('не получилось записать. проверьте поля или напишите мне в WhatsApp', true);
    } else {   // сервер молчит — запись не теряется: то же время сообщением в WhatsApp
      const m = MODE; MODE = 'messenger'; renderSend(S.slot); MODE = m;
      el.q3.textContent = 'онлайн-запись сейчас не отвечает. напишите мне, текст уже готов';
    }
  }

  /* ---------- события ---------- */
  if (DEMO) el.modeBox.hidden = false;
  setMode(MODE);
  el.form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  el.form.addEventListener('input', e => { const k = e.target.name; if (errs[k]) { errs[k].hidden = true; inputs[k].removeAttribute('aria-invalid'); } });
  el.modeBox.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
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
