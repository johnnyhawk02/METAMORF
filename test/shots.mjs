// node test/shots.mjs [url] [outdir]: the page in a browser (Playwright), at Johnny's laptop sizes and on phones, with
// screenshots. Checks the layout (nothing scrolls, every knob on the shared columns, everything inside the screen)
// and the flows (keys, knobs, the dice, ALTER, locks, padlocks, copy and paste, UNDO, presets, ENGINES, the phone's
// pads). Plays through the page's test hook (window.metamorf), so no MIDI device is needed. Fails on any page error.
// Start the page first: node tools/serve.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const url = process.argv[2] || 'http://localhost:8123/';
const out = process.argv[3] || 'shots';
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
let errors = 0;
const J = JSON.stringify;
for (const [w, h] of [[1440, 900], [1280, 800], [1440, 760], [1280, 700]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const bad = (what, ...x) => { errors++; console.log(`${w}x${h}, ${what}:`, J(x).slice(0, 600)); };
  p.on('pageerror', (e) => bad('page error', e.message));
  p.on('console', (m) => { if (m.type() === 'error') bad('console', m.text()); });
  await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.goto(url); await p.waitForFunction(() => window.metamorfReady);
  await p.waitForTimeout(300);
  if (w === 1440 && h === 900) await p.screenshot({ path: `${out}/start-${w}x${h}.png` });
  await p.click('#start-btn'); await p.waitForTimeout(400);
  const M = (f, a) => p.evaluate(f, a);
  // a knob turned the only way it turns: pressed and dragged (up: true turns it up)
  const drag = async (sel, up, dy = 30, n = 0) => { const k = p.locator(sel).nth(n), r = await k.boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 5; i++) await p.mouse.move(x, y + (up ? -1 : 1) * dy * i / 5); await p.mouse.up(); };
  const knobSel = (label) => `.faders .vf:has(.lab:text-is("${label}")) .knob`;
  // ---- the layout: nothing scrolls, everything inside the window, every knob on the grid's columns ----
  const lay = await M(() => {
    const r = (e) => e.getBoundingClientRect(), f = document.getElementById('faders'), fr = r(f), cols = Number(getComputedStyle(f).getPropertyValue('--cols')) || 16;
    const cs = getComputedStyle(f), k = fr.width / f.offsetWidth; // (the screen may be scaled to fit)
    const cw = (f.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * k / cols, x0 = fr.left + (parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)) * k;
    const knobs = [...f.querySelectorAll('.vf:not(.big) .knob')].map((k) => { const x = r(k).left + r(k).width / 2; return (x - x0) / cw; });
    return { scroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
      off: knobs.map((c, i) => [i, c]).filter(([, c]) => Math.abs(c - Math.floor(c) - 0.5) > 0.02).map(([i, c]) => [i, c.toFixed(3), f.querySelectorAll('.vf:not(.big) .lab')[i].textContent]), knobs: knobs.length,
      out: [...document.querySelectorAll('.top > *, .keyhead, .sounds > :not([hidden]), .faders, .status')].filter((e) => { const x = r(e); const s = r(document.getElementById('screen')); return x.left < s.left - 1 || x.right > s.right + 1 || x.top < s.top - 1 || x.bottom > s.bottom + 1; }).map((e) => e.id || e.className),
      screen: [Math.round(r(document.getElementById('screen')).right), Math.round(r(document.getElementById('screen')).bottom)] };
  });
  if (lay.scroll[0] > 0 || lay.scroll[1] > 0 || lay.off.length || lay.knobs < 11 || lay.out.length || lay.screen[0] > w || lay.screen[1] > h) bad('layout', lay);
  // the longest message fits on the status line
  { const fits = await M(() => { const d = document.getElementById('detail'); d.innerHTML = 'new patch <em>ZORVATRON GIMLAR</em>: reverb send on 8 keys · BPM, FX, master reset · <em>12 locked knobs</em> kept'; return d.scrollWidth <= d.clientWidth + 1; });
    if (!fits) bad('the longest message does not fit'); }
  // ---- a key played (MIDI note 50 = the third key) is the key on screen, its engine's tab lit ----
  await M(() => metamorf.noteOn(1, 50, 90)); await p.waitForTimeout(80); await M(() => metamorf.noteOff(50));
  { const s = await M(() => ({ cur: metamorf.cur(), note: document.getElementById('kh-note').textContent, last: document.getElementById('last-text').textContent, tab: document.querySelector('.snd[aria-selected="true"]')?.textContent }));
    if (s.cur !== 2 || s.note !== 'D2' || !/ENGINE 1 D2 #50 · V90/.test(s.last) || !/ENGINE 1/.test(s.tab)) bad('a key played', s); }
  // ---- a knob: dragged up it turns, its label lights, a notch marks where it was; double-click puts it back; UNDO too ----
  const val = (id) => M((id) => metamorf.keys()[metamorf.cur()].p[id], id);
  { const d0 = await val('decay'); await drag(knobSel('decay'), true); const d1 = await val('decay');
    const lit = await M(() => [[...document.querySelectorAll('.faders .vf')].find((e) => e.querySelector('.lab').textContent === 'decay').classList.contains('keyed'), document.getElementById('kh-info').textContent]);
    if (!(d1 > d0) || !/1 edit/.test(lit[1])) bad('a knob turned', d0, d1, lit);
    await p.dblclick(knobSel('decay')); const d2 = await val('decay');
    if (d2 !== d0) bad('double-click puts it back', d0, d2);
    await drag(knobSel('decay'), false); const d3 = await val('decay'); await p.click('#undo'); const d4 = await val('decay');
    if (!(d3 < d0) || d4 !== d0) bad('undo a drag', d0, d3, d4); }
  // only a drag turns a knob: the wheel, hovering and the arrow keys don't
  { const d0 = await val('tune'), r = await p.locator(knobSel('tune')).boundingBox();
    await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.wheel(0, -300); await p.mouse.move(r.x + 2, r.y + 2); await p.keyboard.press('ArrowUp');
    if (await val('tune') !== d0) bad('a knob moved without a drag'); }
  // a drag ends when the window loses focus, even with no button-up heard
  { const r = await p.locator(knobSel('tune')).boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y - 10); await M(() => dispatchEvent(new Event('blur'))); const a = await val('tune');
    await p.mouse.move(x, y - 60); const b2 = await val('tune'); await p.mouse.up();
    if (a !== b2) bad('a drag went on after the window lost focus', a, b2); await p.click('#undo'); }
  // ---- NEW SOUND (the dice), UNDO, ALTER KEY ----
  { const n0 = await M(() => metamorf.keys()[metamorf.cur()].name); await p.click('#rand-key'); await p.waitForTimeout(150);
    const n1 = await M(() => [metamorf.keys()[metamorf.cur()].name, document.getElementById('detail').textContent]);
    await p.click('#undo'); await p.waitForTimeout(50); const n2 = await M(() => [metamorf.keys()[metamorf.cur()].name, document.getElementById('detail').textContent]);
    if (n1[0] === n0 || !n1[1].includes(n1[0]) || n2[0] !== n0 || !/undone/.test(n2[1])) bad('new sound and undo', n0, n1, n2);
    const p0 = await M(() => JSON.stringify(metamorf.keys()[metamorf.cur()].p)); await p.click('#alter-key'); await p.waitForTimeout(100);
    const p1 = await M(() => [JSON.stringify(metamorf.keys()[metamorf.cur()].p), document.getElementById('detail').textContent]);
    if (p1[0] === p0 || !/altered/.test(p1[1])) bad('alter key', p1[1]); }
  // ---- LOCK KEY: the header turns, the dice is off, a knob doesn't move ----
  { await p.click('#lock-key'); const d0 = await val('decay'); await drag(knobSel('decay'), true);
    const s = await M(() => [document.getElementById('screen').classList.contains('keylocked'), document.getElementById('rand-key').disabled, document.querySelectorAll('.k.locked').length]);
    if (!s[0] || !s[1] || s[2] !== 1 || await val('decay') !== d0) bad('lock key', s); await p.click('#lock-key', { force: true }); }
  // ---- a knob padlock: RANDOM on the engine leaves that knob as each key had it ----
  { await p.locator('.faders .vf:has(.lab:text-is("decay")) .lock').first().click();
    const before = await M(() => metamorf.keys().slice(0, 6).map((k) => k.p.decay));
    await p.click('#menu-btn'); await p.click('#scatter'); await p.waitForTimeout(150);
    const after = await M(() => [metamorf.keys().slice(0, 6).map((k) => k.p.decay), metamorf.keys().slice(0, 6).map((k) => k.name), document.getElementById('detail').textContent, document.getElementById('lock-count').textContent]);
    if (J(before) !== J(after[0]) || !/locked DECAY kept/.test(after[2]) || after[3] !== '1 LOCKED') bad('padlock', before, after);
    await p.click('#lock-none'); await p.keyboard.press('Escape'); }
  // ---- COPY and PASTE ----
  { await M(() => metamorf.noteOn(1, 48, 100)); await p.click('#copy-key'); await M(() => metamorf.noteOn(1, 60, 100)); await p.click('#paste-key');
    const s = await M(() => [JSON.stringify(metamorf.keys()[0].p) === JSON.stringify(metamorf.keys()[12].p), metamorf.keys()[12].name === metamorf.keys()[0].name]);
    if (!s[0] || !s[1]) bad('copy and paste', s); }
  // ---- ENGINES 1 to 4 and back: the strip's groups follow, every key keeps its sound ----
  { const sig = await M(() => JSON.stringify(metamorf.keys().map((k) => k.p)));
    for (const n of [3, 2, 1]) { await p.click('#settings-btn'); await p.click('#eng-down'); await p.keyboard.press('Escape'); await p.waitForTimeout(60);
      const g = await M(() => [document.querySelectorAll('#keystrip .kgroup').length, document.querySelectorAll('#keystrip .k').length, document.querySelectorAll('.snd:not([hidden])').length]);
      if (g[0] !== n || g[1] !== 25 || g[2] !== n) bad(`ENGINES ${n}`, g); }
    for (let i = 0; i < 3; i++) { await p.click('#settings-btn'); await p.click('#eng-up'); await p.keyboard.press('Escape'); }
    const s = await M(() => [metamorf.engines(), JSON.stringify(metamorf.keys().map((k) => k.p))]);
    if (s[0] !== 4 || s[1] !== sig) bad('ENGINES back to 4', s[0]); }
  // ---- PRESETS: save, change, revert, save as new, export, import (a hostile name is tidied) ----
  if (w === 1440 && h === 900) {
    await p.click('#preset-btn'); await p.click('#preset-save'); const a = await M(() => [metamorf.presets.list().length, metamorf.presets.dirty(), document.getElementById('preset-mark').textContent]);
    await p.keyboard.press('Escape'); await p.click('#rand-key'); await p.waitForTimeout(400);
    const dirty = await M(() => [metamorf.presets.dirty(), document.getElementById('preset-mark').textContent]);
    await p.click('#preset-btn'); await p.click('#preset-revert'); await p.waitForTimeout(400); const c = await M(() => metamorf.presets.dirty()); await p.keyboard.press('Escape');
    await p.click('#preset-btn'); await p.click('#preset-save-new'); const d = await M(() => metamorf.presets.list().length); await p.keyboard.press('Escape');
    await p.click('#preset-btn'); const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#preset-export')]);
    const file = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    const evil = { app: 'metamorf', kind: 'presets', version: 1, items: [{ id: 'zzzzzz1', name: '<img src=x onerror=alert(1)>', data: { ...file.items[0].data, keys: file.items[0].data.keys.map((k) => ({ ...k, name: '<b>x</b>', p: { ...k.p, decay: 99 } })) } }] };
    const im = await M((t) => metamorf.presets.import(t), J(file)), im2 = await M((t) => metamorf.presets.import(t), J(evil));
    const got = await M(() => { const x = metamorf.presets.list().find((q) => q.id === 'zzzzzz1'); return x && [x.name, x.data.keys[0].name, x.data.keys[0].p.decay]; });
    if (a[0] !== 1 || a[1] || a[2] !== '' || !dirty[0] || dirty[1] !== '*' || c || d !== 2 || file.app !== 'metamorf' || file.items.length !== 2 || im !== 0 || im2 !== 1 || !got || /[<>=()]/.test(got[0] + got[1]) || got[2] !== 1)
      bad('presets', a, dirty, c, d, file.items.length, im, im2, got);
    await p.keyboard.press('Escape');
  }
  // ---- the FX + MASTER tab, and back ----
  await p.keyboard.press('f'); await p.waitForTimeout(100);
  { const s = await M(() => [document.getElementById('fxside').hidden, document.querySelector('.editor').hidden, document.querySelectorAll('#fxglobal .knob').length]);
    if (s[0] || !s[1] || s[2] < 10) bad('the FX tab', s);
    const lay2 = await M(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]); if (lay2[0] > 0 || lay2[1] > 0) bad('the FX tab scrolls', lay2); }
  if (w === 1440 && h === 900 || w === 1280 && h === 700) await p.screenshot({ path: `${out}/fx-${w}x${h}.png` });
  await p.keyboard.press('f');
  // ---- a CC from the Bass Station 2 map turns the key's knob; one for a part not built yet says so ----
  { await M(() => { metamorf.noteOn(1, 55, 100); metamorf.cc(91, 127); }); const s = await M(() => [metamorf.keys()[7].p.decay, document.getElementById('last-text').textContent]);
    await M(() => metamorf.cc(16, 20)); const t = await M(() => document.getElementById('last-text').textContent);
    if (s[0] !== 1 || !/DECAY/.test(s[1]) || !/waits for the filter/i.test(t)) bad('CC', s, t); }
  await M(() => metamorf.noteOn(1, 48, 100));
  await p.screenshot({ path: `${out}/screen-${w}x${h}.png` });
  // the menus open on screen, inside the window
  for (const id of ['menu', 'settings', 'preset']) {
    await p.click(`#${id}-btn`); await p.waitForTimeout(80);
    const r = await M((id) => { const e = document.getElementById(id + '-panel').getBoundingClientRect(); return [Math.round(e.right), Math.round(e.bottom), Math.round(e.left)]; }, id);
    if (r[0] > w || r[2] < 0 || r[1] > h) bad(`the ${id} menu leaves the window`, r);
    if (w === 1440 && h === 900) await p.screenshot({ path: `${out}/menu-${id}.png` });
    await p.keyboard.press('Escape');
  }
  await p.close();
}
// the phone: the 25 pads on five columns, nothing scrolls; a tap plays and picks a pad; two fingers hold two pads;
// NEW SOUND rolls the pad pressed last, UNDO takes it back; the REVERB bar sets its send; LOCK; INIT PATCH asks first
// with a key locked; MENU covers the pads and a press closes it. ?desktop gives the big screen on a phone
for (const [w, h] of [[412, 915], [412, 780], [360, 640]]) {
  const cx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
  const p = await cx.newPage(), cdp = await cx.newCDPSession(p);
  const bad = (what, ...x) => { errors++; console.log(`phone ${w}x${h}, ${what}:`, J(x).slice(0, 500)); };
  p.on('pageerror', (e) => bad('page error', e.message));
  await p.goto(url); await p.waitForFunction(() => window.metamorfReady); await p.waitForTimeout(300);
  const lay = await p.evaluate(() => { const r = (e) => e.getBoundingClientRect(), pads = [...document.querySelectorAll('#pv-pads .pad')], xs = [...new Set(pads.map((e) => Math.round(r(e).left)))];
    return { phone: document.documentElement.classList.contains('phone'), pads: pads.length, xs: xs.length, small: pads.filter((e) => r(e).width < 44 || r(e).height < 44).length,
      scroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight],
      out: [...document.querySelectorAll('#pv > *, #pv button, #pv .track')].filter((e) => !e.closest('[hidden]') && (r(e).left < 0 || r(e).right > innerWidth + 0.5 || r(e).top < 0 || r(e).bottom > innerHeight + 0.5)).map((e) => e.id || e.className),
      offGrid: [...document.querySelectorAll('.pv-row > button, .pv-send .track')].filter((e) => !xs.includes(Math.round(r(e).left))).map((e) => e.id || e.className),
      labels: [pads[0], pads[6], pads[24]].map((e) => e.textContent) }; });
  if (!lay.phone || lay.pads !== 25 || lay.xs !== 5 || lay.small || lay.scroll[0] > 0 || lay.scroll[1] > 0 || lay.out.length || lay.offGrid.length || J(lay.labels) !== J(['C2ENGINE 1', 'F#2ENGINE 2', 'C4ENGINE 4'])) bad('layout', lay);
  await p.tap('#start-btn'); await p.waitForTimeout(400);
  const mid = async (sel, n = 0, fx = 0.5) => { const r = await p.locator(sel).nth(n).boundingBox(); return { x: r.x + r.width * fx, y: r.y + r.height / 2 }; };
  const st = () => p.evaluate(() => { const i = metamorf.cur(), k = metamorf.keys()[i];
    return { i, name: k.name, lock: k.lock, send: k.out.send, key: document.getElementById('pv-key').textContent, what: document.getElementById('pv-what').textContent, msg: document.getElementById('pv-msg').textContent,
      down: document.querySelectorAll('.pad.down').length, out: document.querySelector('#pv-reverb output').textContent, undo: !document.getElementById('pv-undo').disabled, patch: document.getElementById('pv-name').textContent }; });
  const at9 = await mid('.pad', 9); await p.touchscreen.tap(at9.x, at9.y); await p.waitForTimeout(200); const a = await st();
  if (a.i !== 9 || a.key !== 'A2' || !/^ENGINE 2 · /.test(a.what) || a.down) bad('a tap', a);
  const at2 = await mid('.pad', 2), at20 = await mid('.pad', 20);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at2.x, y: at2.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at2.x, y: at2.y, id: 1 }, { x: at20.x, y: at20.y, id: 2 }] }); await p.waitForTimeout(200);
  const two = await st(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(150); const none = await st();
  if (two.down !== 2 || two.i !== 20 || none.down) bad('two fingers', two.down, two.i, none.down);
  await p.touchscreen.tap(at9.x, at9.y); await p.waitForTimeout(150); const b0 = await st();
  await p.tap('#pv-dice'); await p.waitForTimeout(300); const b1 = await st(); await p.tap('#pv-undo'); await p.waitForTimeout(200); const b2 = await st();
  if (b1.name === b0.name || !b1.msg.includes(b1.name) || !b1.undo || b2.name !== b0.name || !/undone/.test(b2.msg)) bad('new sound, undo', b0.name, b1.name, b1.msg, b2.name);
  const r50 = await mid('#pv-reverb .track', 0, 0.5); await p.touchscreen.tap(r50.x, r50.y); await p.waitForTimeout(100); const c1 = await st();
  if (Math.abs(c1.send * 127 - 64) > 4 || c1.out !== String(Math.round(c1.send * 127)) || !/REVERB send/.test(c1.msg)) bad('reverb send', c1.send, c1.out, c1.msg);
  await p.tap('#pv-lock'); await p.waitForTimeout(100); const d1 = await st();
  await p.tap('#pv-init'); await p.waitForTimeout(100); const ask = await p.textContent('#pv-init');
  await p.tap('#pv-init'); await p.waitForTimeout(400); const d2 = await st();
  if (!d1.lock || ask !== 'PRESS AGAIN' || d2.lock || d2.name === d1.name || d2.patch === d1.patch || !/new patch/.test(d2.msg)) bad('lock, init patch', d1.lock, ask, d2);
  await p.tap('#pv-menu-btn'); await p.waitForTimeout(150);
  const m = await p.evaluate(() => { const r = (e) => e.getBoundingClientRect(), mm = document.getElementById('pv-menu'), hit = (e) => { const x = r(e); return document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); };
    return { open: !mm.hidden, btn: document.getElementById('pv-menu-btn').textContent, first: mm.querySelector('button').textContent, covers: [document.querySelectorAll('.pad')[12], document.getElementById('pv-undo')].every((e) => mm.contains(hit(e))) }; });
  if (w === 412 && h === 915) await p.screenshot({ path: `${out}/phone-menu.png` });
  await p.tap('#pv-alter-eng'); await p.waitForTimeout(300); const m2 = await st(), open = await p.evaluate(() => !document.getElementById('pv-menu').hidden);
  if (!m.open || m.btn !== 'CLOSE' || m.first !== 'RANDOM: ENGINE 2 KEYS' || !m.covers || open || !/ENGINE 2: every key altered/.test(m2.msg)) bad('the menu', m, open, m2.msg);
  const end = await p.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
  if (end[0] > 0 || end[1] > 0) bad('it scrolls after use', end);
  await p.screenshot({ path: `${out}/phone-${w}x${h}.png` });
  if (h === 780) { await p.goto(url + '?desktop'); await p.waitForFunction(() => window.metamorfReady);
    const dk = await p.evaluate(() => [document.documentElement.classList.contains('phone'), getComputedStyle(document.getElementById('pv')).display]);
    if (dk[0] || dk[1] !== 'none') bad('?desktop', dk); }
  await cx.close();
}
// ?phone on a computer: the phone view; without it the computer never gets it
{ const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(url + '?phone'); await p.waitForFunction(() => window.metamorfReady);
  const ph = await p.evaluate(() => [document.documentElement.classList.contains('phone'), document.querySelectorAll('.pad').length]);
  await p.goto(url); await p.waitForFunction(() => window.metamorfReady);
  const dk = await p.evaluate(() => document.documentElement.classList.contains('phone'));
  if (!ph[0] || ph[1] !== 25 || dk) { errors++; console.log('?phone on a computer:', J([ph, dk])); }
  await p.close(); }
await b.close();
console.log(errors ? `${errors} problems` : 'ok: no problems');
process.exit(errors ? 1 : 0);
