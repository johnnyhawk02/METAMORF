// PHONE: on a phone held upright (or with ?phone in the address) the page is a simpler instrument: a pad for each of
// the 25 keys (pressed and held like a key, several fingers at once), NEW SOUND (the dice) and ALTER for the pad
// pressed last, its REVERB send, LOCK, INIT PATCH, RANDOM ALL and UNDO, and a MENU with RANDOM and ALTER for that
// pad's engine and ALTER ALL. Its buttons press the big screen's own, so the rules live in one place. ?desktop keeps
// the big screen on a phone.
import { $, clamp } from './controls.js?v=mwm8ui4x';

export function setupPhone(A) {
  const { S, KEYS, engOf, zone, noteOf, noteName, ENG } = A;
  const asked = new URLSearchParams(location.search);
  // (the phone's own size, not only the window's: a wide page makes a phone's browser zoom out and report it wider)
  const want = () => (asked.has('desktop') ? false : asked.has('phone') || ((Math.min(screen.width, screen.height) <= 700 || innerWidth <= 700) && innerHeight > innerWidth));
  const P = { on: false };
  const pads = [];
  P.buildPads = () => {
    $('pv-pads').innerHTML = ''; pads.length = 0;
    for (let place = 0; place < KEYS; place++) {
      const e = engOf(place), b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.className = 'pad e' + e;
      b.innerHTML = `<b></b><span>${ENG(e)}</span><svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 8V5a4 4 0 0 1 8 0v3"/><rect x="1.5" y="8" width="13" height="9" rx="1"/></svg>`;
      let down = false;
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch (err) { /* the pointer is gone already */ }
        down = true; b.classList.add('down');
        A.startAudio().then(() => { if (down) A.keyDown(place, 100); });
      });
      const up = () => { if (!down) return; down = false; A.noteOff(noteOf(place)); b.classList.remove('down'); };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
      b.addEventListener('contextmenu', (ev) => ev.preventDefault()); // (a long press holds the key: no menu)
      $('pv-pads').append(b); pads.push({ b, place });
    }
  };
  // the REVERB send of the pad pressed last: a touch sets it, the bar follows the finger
  const rev = $('pv-reverb'), track = rev.querySelector('.track'), fill = track.querySelector('i'), outEl = rev.querySelector('output');
  const at = (ev) => { const r = track.getBoundingClientRect(); return clamp((ev.clientX - r.left - 4) / (r.width - 8), 0, 1); };
  const put = (x) => {
    const k = S.keys[S.cur]; if (k.lock) { A.lockedMsg(); return; }
    const v = Math.round(x * 127) / 127; if (v === k.out.send) return;
    A.editOut('send', v); drawSend(); A.detail(`${ENG(engOf(S.cur))} ${noteName(noteOf(S.cur))} REVERB send <em>${A.sendText(v)}</em>`);
  };
  let sliding = false;
  track.addEventListener('pointerdown', (ev) => { ev.preventDefault(); try { track.setPointerCapture(ev.pointerId); } catch (err) { /* gone */ } sliding = true; put(at(ev)); });
  track.addEventListener('pointermove', (ev) => { if (!sliding) return; if (!ev.buttons) { sliding = false; return; } put(at(ev)); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(ev, () => { sliding = false; });
  addEventListener('blur', () => { sliding = false; });
  const drawSend = () => { const v = S.keys[S.cur].out.send; fill.style.width = `${v * 100}%`; outEl.textContent = A.sendText(v); track.setAttribute('aria-valuenow', Math.round(v * 127)); };
  for (const [id, to] of [['pv-alter', 'alter-key'], ['pv-lock', 'lock-key'], ['pv-init', 'init-patch'], ['pv-random', 'kit-scatter'], ['pv-undo', 'undo'], ['pv-dice', 'rand-key']]) $(id).addEventListener('click', () => $(to).click());
  const menu = (open) => { $('pv-menu').hidden = !open; $('pv-menu-btn').setAttribute('aria-expanded', open); $('pv-menu-btn').textContent = open ? 'CLOSE' : 'MENU'; if (open) P.draw(); };
  $('pv-menu-btn').addEventListener('click', () => menu($('pv-menu').hidden));
  for (const [id, to] of [['pv-rand-eng', 'scatter'], ['pv-alter-eng', 'alter'], ['pv-alter-all', 'kit-alter']]) $(id).addEventListener('click', () => { menu(false); $(to).click(); });
  // what the big screen says and shows, said and shown here too: the message line, UNDO there to press, INIT PATCH asking
  const mirror = (el, opts, fn) => { new MutationObserver(fn).observe(el, opts); fn(); };
  mirror($('undo'), { attributes: true, attributeFilter: ['disabled'] }, () => { $('pv-undo').disabled = $('undo').disabled; });
  mirror($('init-patch'), { attributes: true, attributeFilter: ['aria-pressed'] }, () => { const a = $('init-patch').getAttribute('aria-pressed') === 'true'; $('pv-init').setAttribute('aria-pressed', a); $('pv-init').textContent = a ? 'PRESS AGAIN' : 'INIT PATCH'; });
  new MutationObserver(() => { $('pv-msg').innerHTML = $('detail').innerHTML; }).observe($('detail'), { childList: true, characterData: true, subtree: true });
  P.draw = () => {
    if (!P.on) return;
    for (const { b, place } of pads) {
      b.firstChild.textContent = noteName(noteOf(place)); b.setAttribute('aria-label', `${ENG(engOf(place))} ${noteName(noteOf(place))}`);
      b.classList.toggle('sel', place === S.cur); b.classList.toggle('locked', S.keys[place].lock);
    }
    const e = engOf(S.cur), z = zone(e), n = z.hi - z.lo + 1;
    $('pv-rand-eng').textContent = `RANDOM: ${ENG(e)} KEYS`; $('pv-rand-eng-cap').textContent = `A NEW SOUND ON EACH OF THE ${n} ${ENG(e)} KEYS`;
    $('pv-alter-eng').textContent = `ALTER: ${ENG(e)} KEYS`; $('pv-alter-eng-cap').textContent = `NUDGE THE SOUNDS OF THE ${n} ${ENG(e)} KEYS`;
    const k = S.keys[S.cur];
    $('pv-key').textContent = noteName(noteOf(S.cur));
    $('pv-what').textContent = `${ENG(e)} · ${k.lock ? 'locked · ' : ''}${A.whatText(k)}`;
    $('pv-lock').setAttribute('aria-pressed', k.lock); $('pv-lock').textContent = k.lock ? 'LOCKED' : 'LOCK';
    $('pv-dice').disabled = k.lock; $('pv-alter').disabled = k.lock;
    $('pv-name').textContent = S.preset.name;
    drawSend();
  };
  // the phone view on or off (the window's shape can change): true when on
  P.set = () => { const on = want(); if (on !== P.on) { P.on = on; document.documentElement.classList.toggle('phone', on); P.draw(); } return P.on; };
  return P;
}
