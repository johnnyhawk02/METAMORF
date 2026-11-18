# METAMORF: specification

A percussion synth for the browser. It keeps the way LXR-AFX is played and edited (the screen, the 25 keys, MIDI, the randomisers, morph keys, locks, undo, auto level, presets, the phone screen) and replaces its sound engine with a new wavetable engine, written from scratch. The goal is a new work, not one derived from the GPL LXR-02 firmware.

Written 2026-11-18 from lxr-afx at commit `6b3aa30` (johnnyhawk02/lxr-afx, `main`), and from Johnny's answers about the new engine.

Contents
1. Ground rules (clean room, standing rules)
2. What carries over from LXR-AFX (features, by behaviour)
3. What to copy, adapt, rewrite or leave out (file by file)
4. The new engine (behaviour only)
5. FX and master
6. Sounds, the rating mode and the randomisers
7. Morphing
8. Storage formats
9. Tests and acceptance
10. Build order
11. Open questions for Johnny

---

## 1. Ground rules

### 1.1 Clean room

- **Don't read the old engine.** Never open, fetch, search or quote the LXR-02 firmware, Elixir Desktop's engine, erica-synths/lxr-desktop-app, or these lxr-afx paths: `engine/`, `test/ref/`, `sound/schema.js`, `sound/instrument.js`, `sound/level.js`, `sound/morph.js`, `sound/kits.js`, `kits/`, `tools/build-kits.mjs`, `tools/name-kits.mjs`, `tools/levels.mjs`, or any test that imports them.
- **Only copy the files listed in section 3.1**, from commit `6b3aa30`, fetched with a sparse checkout so nothing else lands on disk (the command is in PROMPT.md).
- **Write the DSP from published, general knowledge:** textbooks, papers and standard methods (state-variable and TPT filters, band-limited wavetables, FDN or allpass-loop reverbs, feed-forward compressors, ITU-R BS.1770 loudness). Don't use any code or constants from a drum machine's firmware.
- **No LXR names.** Nothing in METAMORF is called LXR, AFX, Elixir, Erica, or after any part of the old engine. The copied files are scrubbed of every such mention (code, comments, captions, tooltips, logo, title, storage keys, export ids) before the first commit, and a test fails the build if `lxr`, `afx`, `elixir` or `erica` appears anywhere outside this spec. Parameter names, sections and defaults come from this spec, not from the old schema.
- **No LXR sound data.** No kit files, kit sounds, kit-derived numbers (for example the old AUTO LEVEL targets were measured from the LXR kits, so they don't carry over either) and no click or wave samples. Every sound METAMORF ships is made by METAMORF's own engine and kept by Johnny in the rating mode (section 6).

### 1.2 Johnny's standing rules (all from LXR-AFX, all still apply)

- **No 3D view, ever.** No three.js, no hardware-on-a-desk look, no skeuomorphic panel. Johnny turned it down twice. Don't suggest it.
- **Everything on a grid.** Equal cells, one knob to a cell. Every knob lines up with the ones above and below it. A menu takes two cells. Rules (lines) sit on cell edges and never shift a knob.
- **Controls change only on click and drag.** No scroll wheel, no trackpad, no arrow-key nudging, no focus ring. Passing the pointer over a control never changes it. A drag must end even if the pointerup is missed: on any move with the button up, on lost pointer capture, on window blur and on the tab being hidden.
- **Edit only the key played.** A knob always changes the last key pressed (or the key picked on the strip). There is no "all keys" mode.
- **No hidden modes, little clutter.** Set-and-forget controls go in SETTINGS. The main screen is for playing and editing.
- **No sequencer.** It was built and removed ("I don't find it useful"). A key plays once per press.
- **Plain words.** Johnny didn't know what SCATTER meant: the names are RANDOM and ALTER. Captions under buttons say what they do in a few plain words.
- **Colours come from two values.** Every colour on screen derives from `--panel-rgb` and `--ink-rgb`. Never hardcode a colour.
- **Much easier than the hardware.** Obvious feedback (a message line that says what happened and what was kept), nothing hidden.

---

## 2. What carries over (by behaviour)

These are the features of LXR-AFX at `6b3aa30`, minus the engine, with the changes METAMORF needs. Where the old code is generic and copyable, section 3 says so.

### 2.1 Screen and layout

- **One screen, nothing scrolls**, laid out for a laptop (1440 x 900 native). Below about 1264 x 850 the whole screen scales down to fit (the old `fitScreen`). Johnny's MacBook Air M1 browser windows are 1440 x 760 and 1280 x 700: both must fit.
- **LCD look**: one pane of LCD glass, one ink colour, a faint ghost of unlit segments, an offset shadow, the VT323 pixel font, buttons as outlined boxes that invert when pressed or chosen, segmented bars and meters.
- **Top bar**: logo (METAMORF), PRESET menu (the patch's name, a `*` when unsaved), MIDI status box, LAST box (the last key played and how hard), SETTINGS menu, RANDOM menu, UNDO.
- **Key panel** (top left): KEY note name and number, its engine and what it plays ("NAME · MID · 2 edits"), the **key strip** of all 25 keys (grouped by engine, a padlock on locked keys, a dot on hand-edited keys; click a key to pick and hear it), and a row of buttons: **NEW SOUND** (a flat 2D dice that turns once and changes face a few times in about a third of a second, K), **ALTER KEY** (an icon of three sliders, A), **LOCK KEY** (L), **COPY**, **PASTE**, **CLEAR**. Under them **MAKE THIS KEY**: one row of five buttons, the four groups and ANY (LOW, MID, MID-HIGH, TREBLE, ANY; see 6.1). A locked key turns the header black and veils the knobs ("KEY LOCKED · LOCK KEY (L) unlocks it").
- **Engine bar**: ENGINE 1 to N buttons, each sitting right under its group of keys on the strip, and an **FX + MASTER** tab (F).
- **Knob grid**: the key's sound as knobs, in rows of sections, on one grid shared by every engine. The two rightmost columns hold the key's **FX SEND** (REVERB only now, see 5) and its big **LEVEL** knob, with an **AUTO** chip above LEVEL showing the key's trim ("AUTO -3.5dB"; press it to re-measure). The grid for the new engine is laid out from section 4's parameters: 47 sound knobs in four rows of 13 columns, plus the two OUTPUT columns (4.2 has the layout). Modulation amounts are not knobs on the grid: they live in each knob's **modulation popup** (2.2). Keep it to whole rows; check every knob sits on the shared column positions.
- **Status line** at the bottom: what just happened, what was kept ("locked DECAY, CUTOFF kept"), and the zones.

### 2.2 Knobs

- Press and drag up or down. A hand edit **lights the knob's label**, a notch outside the ring marks the value it had, and a **double-click puts it back**. The key header counts the edits.
- **Plus-minus knobs** (pan, tune, bipolar amounts) have their centre at the top and light outwards. PAN reads L100 … C … R100.
- **Padlock** at each knob's top right (faint open, solid closed). See 2.6.
- **Modulation popup (right-click a knob)**: a right-click (a two-finger click on a trackpad) on a sound knob opens a small popup next to it, titled with the knob ("CUTOFF · MODULATION"), with one row per source: **MOD ENV**, **LFO**, **VELOCITY**. Each row is a flat horizontal fader with its amount (plus-minus, centre = none, lit outwards like a bipolar knob, the value in the knob's own units: "+24 st", "-0.35"). The popup sits on the grid: each fader row spans the cells of the popup's width, and the popup is placed so it doesn't cover its own knob.
  - Faders follow the knob rules: they change only on click and drag (no wheel, arrow keys, focus rings or hover), the drag ends on any move with the button up, lost pointer capture, window blur and a hidden tab, and a **double-click puts a fader back** to the value it had when the popup opened. **CLEAR** in the popup sets every amount for that knob to none.
  - The popup closes on a click outside it, on Escape, on a second right-click on the knob, and when another key is picked. It never opens on hover. Only one popup is open at a time.
  - Like a knob, a fader edits only the key played, counts as a hand edit (it lights the knob's label), is undoable, and is glided in the engine (4.1).
  - **Showing modulation without opening the popup**: a knob with any amount other than none shows a small mark beside its label (for example a dot per source) and a thin arc outside its ring showing how far the modulation reaches from the knob's value (the largest of its sources, MOD ENV and LFO in one direction or both, VELOCITY from soft to hard). Hide nothing: everything that shapes the sound is visible on the grid, even if its amount is set in the popup.
  - The source settings themselves (MOD ENV DECAY and CURVE, LFO RATE and SHAPE) stay as knobs on the grid, since every destination shares them.
  - **Padlocks**: a closed padlock on a knob keeps its modulation amounts too.
  - **LEARN**: a fader can be learned like a knob (press LEARN, click the fader, turn a hardware knob).
  - Right-click on a non-sound control (OUTPUT, FX, the strip) does nothing and shows no browser menu. On the phone there are no knobs and no popup.
- Values are continuous (section 4). A knob may show soft labels along its range (for example a table position or filter morph reading "LP > BP 40"), but there are no menus and no switches in a sound.

### 2.3 Keys, engines and playing

- **25 keys** on MIDI channel 1, for a Novation Bass Station 2 at its default octave (lowest key MIDI 48). **LOW KEY** (SETTINGS) moves the layout by octaves. Velocity is used. Note-offs from MIDI and from the strip; MIDI all-notes-off releases everything.
- **Every key has its own sound.**
- **ENGINES 1 to 4** (SETTINGS, was 1 to 6): that many mono engines, the 25 keys split into even side-by-side zones, the extra keys at the top: 1 = 25, 2 = 12 + 13, 3 = 8 + 8 + 9, 4 = 6 + 6 + 6 + 7. Changing the count keeps every key's sound where it can, deals new sounds onto keys that had none, and is undoable. Only engines in use render.
- **Mono, last-note priority, per zone.** A new key in a zone takes over with its own sound. Let go of it while an earlier key of the zone is still held and the earlier one comes back on the next step of the BPM grid (**RETURN** in SETTINGS: NOW, 1/32, **1/16** as it comes, 1/8, 1/4). Zones don't affect each other.
- **BPM** (SETTINGS) 40 to 240, double-click for 120. With no echo and no sequencer, BPM now only drives RETURN; keep it.
- **Computer keys**: `[` `]` or left/right arrows step to the key before or after and play it; Space plays it again; K new sound; A alter key; L lock key; Z undo; F the FX + MASTER tab; R the RATE tab (while RATE is open, its own shortcuts take over the letter keys); 1 to 4 pick an engine; Cmd/Ctrl+C and V copy and paste a key. Buttons show their keys.

### 2.4 MIDI and hardware knobs

- Web MIDI (Chrome, Edge). START AUDIO + MIDI overlay on first load (browsers need a gesture).
- **Knob map for the Bass Station 2** (CC on channel 1, acting on the last key played): filter freq (CC 16) → cutoff, resonance (82) → resonance, overdrive (114) → drive, amp attack (90) / decay (91) → amp attack / decay, mod env depth (85) → pitch env amount, mod env decay (103) → pitch env decay, distortion (94) → FM amount, osc 1 coarse (27) / fine (26) → tune / fine, LFO 1 speed (18) → was the echo send, needs a new target (see 11), portamento (5) → reverb send, osc 1 / osc 2 / sub levels (20, 21, 22) → engine 1 / 2 / 3 levels. Re-point each to the new engine's matching parameter.
- **LEARN** (SETTINGS): press it, click a control on screen, turn a hardware knob. **BS2 MAP** puts the default back. The map is kept in the browser, not in presets.

### 2.5 Randomisers (the RANDOM menu and the key panel)

- **INIT PATCH** (top of the menu): a new patch in one press. Every key gets a fresh sound, levelled and panned as RANDOM ALL deals them; **30% of the keys get a reverb send** (8 of 25, chosen at random, in a range of 45..95 out of 127). Locked keys and hand edits are replaced, so if any key is locked it asks first (press again within four seconds). BPM back to 120; reverb, distortion, compressor and output level back to their defaults; RETURN, engine levels and the knob padlocks stay. A knob with a closed padlock keeps its setting on every key. The patch gets a new name and is unsaved. UNDO brings the old patch back whole.
- **MORPH KEYS**, **NEW ENDS**, **LOW > TREBLE**: see section 7.
- **NEW SOUNDS FROM**: the source the dice, RANDOM, RANDOM ALL and INIT PATCH use. In METAMORF: **LIBRARY** (a kept sound as it is; was KIT), **BREED**, **MORPH**, **STYLE** (was KIT-STYLE), **FREE**, **RECIPE**. Section 6 defines each against the sound library.
- **THIS ENGINE**: RANDOM (every key of the engine gets a new sound), ALTER (nudge every key around what it plays now), LEVEL (even out the keys' loudness without changing the sounds). **ALL ENGINES**: RANDOM ALL, ALTER ALL, LEVEL ALL. Each button has a caption.
- **HOW MUCH**: the ALTER amount (10% as it comes; ALTER KEY uses it too). **WILD**: ALTER may take a control outside its usual percussion range.
- **AUTO LEVEL** checkbox (on as it comes).
- **KNOB PADLOCKS**: the count of closed padlocks and UNLOCK ALL.
- **ALTER always starts from the sound's "home"** (what it was before the first alter since the last hand edit), so repeated presses vary one sound instead of drifting away.
- **New sounds keep a key's send** (locked or not).
- **Pan when randomising**: LOW centred, MID within 20% left or right, MID-HIGH and TREBLE anywhere (was per engine type: drum, snare, metal; now per group, 6.1). Set by hand, any pan goes anywhere; the pan padlock keeps it out of the randomisers.
- **Duds are skipped**: every generated sound is played offline first and thrown away if it is silent (more than 24 dB under its level target), still loud at 1.5 s, clips hard, or produces NaN or DC. Up to 8 tries, then the best try.

### 2.6 Locks

- **LOCK KEY** freezes a key's whole sound: nothing random, CLEAR or INIT (without asking) changes it until it is unlocked.
- **Knob padlocks**: a closed padlock keeps that knob's setting on every key of its engine through every randomiser (dice, RANDOM, ALTER, ALTER KEY, the ALL versions, INIT PATCH, MAKE THIS KEY, MORPH KEYS). Only a hand edit, UNDO and loading a preset change a locked knob. Nothing is locked as it comes. The message line names what was kept.

### 2.7 Copy, paste, clear, undo

- **COPY / PASTE** a key's whole sound. With one engine design for every engine, a paste is exact (no cross-engine mapping is needed any more).
- **CLEAR** puts a key back to the engine's base sound.
- **UNDO**: 40 steps over every change to the sounds (a whole knob drag is one step, a randomiser, NEW SOUND, ALTER KEY, PASTE, CLEAR, ENGINES, a preset load, INIT PATCH). The status line says what it undid. Effects and master changes are not in the undo stack, except as part of a preset load or INIT PATCH (which snapshot everything).

### 2.8 Auto level

- Every sound a randomiser deals or alters (and a paste, and a MAKE THIS KEY) is played offline, measured, and its key gets a **trim**, a gain of its own, separate from LEVEL. Loudness = the loudest 100 ms of the hit at velocity 100, K-weighted per ITU-R BS.1770, in dB below full scale. The trim brings it to its target, never past full scale, at most +12 dB or -16 dB.
- **Targets are per group** (LOW, MID, MID-HIGH, TREBLE), set from the median loudness of Johnny's kept sounds of that group once there are enough (5 or more), otherwise one shared starting target (start at -15 dB and adjust by ear). Don't reuse the old numbers.
- **AUTO** chip above LEVEL: shows the trim, press to re-measure. **LEVEL / LEVEL ALL** even out the keys as they are. **AUTO LEVEL** off: new sounds play as loud as they come out. Locked keys are left alone. UNDO takes it back.
- Offline renders run in a Web Worker so the page never stalls.

### 2.9 Presets and names

- **PRESET menu** (the patch's name beside the logo): a name box (Enter renames), **NEW NAME**, **SAVE**, **SAVE AS NEW**, **REVERT**, a list (click to load, UNDO takes the load back, **X** then **SURE?** deletes), **EXPORT** (all presets to one JSON file) and **IMPORT** (add a file's presets). A preset holds every key's sound, hand edits, lock, send, pan, level and trim, the engine count, the effects, the master and the BPM. Not in a preset: knob padlocks, the knob map, LOW KEY, the RANDOM menu's settings, screen colours. Keys are stored by place in the layout, so a preset loads the same at any LOW KEY. Imports are sanitised (names, labels, ranges), because messages are shown as HTML.
- **Auto names**: copy `app/names.js` as it is. Names are jumbled from pieces of words in six themed lists (space, physics, Tolkien, fantasy, alien, myth), joined where a vowel meets a consonant, always mixing two lists, never a real list word, never a name in use. One word of 6 to 10 letters or two of 4 to 7. Kept sounds in the library are named the same way.

### 2.10 Settings and screen colours

- **SETTINGS** menu: TEMPO (BPM, RETURN), KEYBOARD (ENGINES, LOW KEY), SCREEN COLOURS, HARDWARE KNOBS (LEARN, BS2 MAP), and new: WAVETABLES (section 4.3: load, list and delete user tables).
- **SCREEN COLOURS**: six looks (LCD, BLUE LCD, PAPER, AMBER, GREEN CRT, NIGHT), or your own PANEL and TEXT colours, RESET back to LCD. Applied before first paint by an inline script. Kept in the browser.

### 2.11 FX + MASTER tab

- The right side of the old screen became a tab of its own (F). It holds **SEND FX** (now only the REVERB) and **MASTER**: the distortion with its sidechain, the compressor with a gain-reduction meter, the output level. Section 5.

### 2.12 Phone

- A phone held upright gets a simple screen by itself, at the same address (detected from `screen.width/height`: short side ≤ 700 and taller than wide, set before first paint; `?phone` forces it, `?desktop` forces the big screen). Johnny's phone is a Pixel 9a (412 wide); also check 360 x 640.
- **25 pads** on a five-column grid (lowest top left, shaded by engine), each playing while held, several fingers at once. The pad pressed last is the one the buttons act on: **NEW SOUND** (the dice), **ALTER**, **LOCK**, a **REVERB** bar for its send (touch or slide). Then **INIT PATCH**, **RANDOM ALL**, **UNDO** and a two-line message line. **MENU** (top right; reads CLOSE while open): RANDOM and ALTER for the engine of the last pad, ALTER ALL. A press does its thing and closes the menu.
- The phone buttons press the big screen's own buttons, so the rules live in one place. No presets, knobs or effects on the phone, and it doesn't ask for MIDI.
- Change from LXR-AFX: the ECHO bar goes (no echo).

### 2.13 Dropped from LXR-AFX

The echo (and its SYNC and PING-PONG), the kits and everything that reads them, the per-key sequencer's leftovers, the old key morph (`sound/morph.js`), the six-engine maximum, the drum/snare/metal engine types, and the old stored-data conversions (`posRule`, `lockRule`, `panRule`, `OLD_LABELS`, menu-to-detent conversions). METAMORF starts with fresh storage keys and no history to convert.

---

## 3. Files: copy, adapt, rewrite, leave out

### 3.1 Copy (from lxr-afx `6b3aa30`; the only files the new project may fetch)

| File | What to do | Why it's clean |
|---|---|---|
| `sound/dirt.js` | **Copy as is.** The master distortion. The host passes the sidechain signal (`process(L, R, key)`; `key` null = the mix), so it needs no change for 1 to 4 engines. | Written new in one commit (`ab6a46a`, 2026-11-17) as "our own design, after the signal flow of a dual-path bass distortion pedal". It imports nothing, and it replaced the firmware's waveshaper rather than changing it. Johnny confirms it isn't LXR-derived. |
| `app/names.js` | **Copy, then drop the word "elixir" from the fantasy list and the LXR-AFX header comment.** Otherwise unchanged. | Our own word lists and jumbler; no engine link. |
| `test/names.test.mjs` | **Copy as is.** | Tests names.js only. |
| `tools/stamp.mjs` | **Copy, update its file list.** Cache-busting `?v=` stamps on every module import; run before each commit that changes the page (GitHub Pages served a mix of old and new modules once and froze the page). | Generic tool. |
| `css/lcd.css` | **Copy, then adapt**: header comment, logo, drop echo and sequencer rules, re-check grid widths for the new knob count. | Our own CSS. Johnny confirmed the look is his own (3.4). |
| `index.html` | **Copy, then adapt**: title, description, logo, no echo, REVERB only on the phone, WAVETABLES and RATE added, captions that say "all engines" rather than "all three". Keep the inline colour and phone scripts and the load-failure check. | Our own markup. |
| `app/main.js` | **Copy as a reference and lift its generic parts** (list below); rewrite everything that touches the sound's parameters. Split it into modules while porting (it is 1,859 lines). | Our own UI code (3.4), but full of references to the old parameter set. |
| `test/shots.mjs` | **Copy, then adapt**: the Playwright checks of layout (on the grid, nothing scrolls), sizes, phone, dice, undo, presets, locks. Storage keys and controls change. | Our own test. |
| `test/dirt.test.mjs` | **Copy, then rewrite its harness** against the new instrument (it imports the old one). | The checks of the distortion are ours. |

Generic parts of `app/main.js` to lift (as is or nearly): `dragger` (with all its drag-ending guards), the knob SVG and ring lighting (`KNOB_SVG`, `knobF`, `knobDeg`, `lightRing`, the plus-minus centre), padlock icon, `hbar`, dice (`DICE_PIPS`, `DICE_FACES`, `rollDice`), screen colours (`THEMES`, `applyColours`), menus open/close, the undo stack (`snapshot`, `undo`), presets (store, save, save as new, revert, delete with SURE?, export, import, `tidyPreset`, `canon` dirty check), MIDI (`startMidi`, `onMidi`, note on/off, `held` stacks, all-off), CC handling and LEARN (`onCC`, `setLearn`), the key strip and `stepKey`, `copyKey` / `pasteKey`, `lockKey`, `initPatch` flow (arm and confirm), `fitScreen` and `alignEngines`, the whole phone section, the `rnd` xorshift. Re-target each to the new schema.

### 3.2 Rewrite (keep the behaviour, write new code)

| Old file | New | Notes |
|---|---|---|
| `sound/schema.js` | `sound/params.js` | Built from section 4 of this spec. The old one is generated from the firmware's front-panel data: don't open it. |
| `sound/instrument.js`, `sound/worklet.js` | `engine/` (new) and `sound/worklet.js` | A pure JS instrument (no DOM, no Web Audio) that renders float buffers at any rate, so it runs in an AudioWorklet, in a Worker for offline renders, and in node for tests. That architecture is generic; write it fresh. |
| `sound/level.js` | `sound/level.js` (new) | Same measurement (section 2.8), against the new engine, per-group targets. Write the K-weighting filter from the BS.1770 standard. |
| `sound/breed.js`, `sound/makers.js` | `sound/makers.js` (new) | Same ideas (section 6.4), new sections, recipes learned from kept sounds. The old recipe numbers are in the old parameter units: don't carry them. |
| the compressor (inside the old instrument) | `sound/comp.js` | Johnny wants it rewritten fresh. Same knobs (section 5.3). |
| the reverb | `sound/reverb.js` | New, similar in feel, not copied (section 5.1). |

### 3.3 Leave out (LXR-derived or not needed)

- `engine/lxr.js`, `engine/lxr-tables.js`, `engine/lxr-ui-data.js`, `engine/lxr-clicks.js`: the firmware's engine, tables, front-panel data and click samples, ported. **GPL, Erica Synths.**
- `test/ref/lxr-ref.js`: a reference copy of the firmware engine.
- `kits/**/*.SND` (the firmware's factory kits, Elixir's kits, and the Hrtl DLC kits): **third-party sound data**. `kits/names.json`, `sound/kits.js`, `tools/build-kits.mjs`, `tools/name-kits.mjs`, `tools/levels.mjs`: built from them.
- The `.SND` format and `parseSnd`; the old parameter numbers, names, ranges, sections and defaults (the init kit); the modulation target lists; the wave set and the filter-type set; the "kind" smoothing settings; the old AUTO LEVEL targets (measured from the kits); the old engine's sample rate and block size.
- The stereo reverb's right-hand taps (a change to the firmware reverb) and the echo (the firmware's delay).
- `sound/morph.js` (unused) and the tests of anything above: `merged`, `switches`, `legato`, `morph`, `keymorph`, `breed`, `makers`, `level`, `reverb`.
- `LICENSE` (GPL-3.0, required because of the firmware port), `README.md`, `docs/screenshot.png`.
- Names: LXR, LXR-02, AFX (in the product name), Elixir, Erica, and the old engine types (drum, snare, metal as engine names). Sound type tags such as "kick" and "snare" are ordinary words and fine.

### 3.4 Provenance notes

1. **Where the look and the randomiser logic came from: settled.** `css/lcd.css` calls itself "the look of Elixir Desktop" and `app/main.js` calls its randomisers "the logic of Elixir Desktop's". Johnny confirmed on 2026-11-18 that Elixir Desktop's UI and ALTER code were written new for him; only the sound engine and the FX were ported from the LXR-02. So the files in 3.1 are his own work and can be copied.
2. **Licence of the new repo.** Code copied from lxr-afx sits in a GPL-3.0 repo today. Code Johnny commissioned and owns can be released under any licence, as long as no third-party GPL code is mixed in (flag 1 confirms none is in the files of 3.1). Pick a licence when the repo is made (MIT, or all rights reserved for now).
3. **The Bass Station 2 map** uses Novation's published CC numbers: fine to keep.

---

## 4. The new engine (behaviour only)

### 4.1 Principles

- **Percussion only.** One-shot sounds, triggered by a key, no sustain stage, no polyphony inside an engine.
- **Every parameter is continuous** and stored as a normalised float (0..1, or -1..1 for bipolar), mapped to real units by a curve (log for frequencies and times). No menus, no switches, no discrete settings in a sound. Where an old design would use a switch, use a continuous blend.
- **Morph-friendly**: any two sounds can be interpolated parameter by parameter and every point between them is a sensible sound (section 7). A part is switched off by its level reaching zero, never by a switch.
- **Smooth**: every parameter change (a knob, a fader in a modulation popup, a CC, a morph, a modulation) is glided (about 5 to 10 ms) and must never click, zipper or jump in level. A parameter changed while a note sounds takes effect smoothly, on the note that is playing.
- **Repeatable**: oscillator phases reset at each note start (with a START PHASE control), noise is seeded per note from the sound, so a sound plays the same every time (needed for auto level and for the rating mode).
- **Click-free retrigger**: a new note on an engine that is still sounding fades the old tail out over 2 to 4 ms while the new note starts.
- **A voice ends** when its output stays below -90 dB for 50 ms (so comb and formant tails aren't cut).
- **Runs anywhere**: plain JS, renders float blocks at the output sample rate. Oversample the FM and the drive stages where aliasing is audible (2x is enough; measure it).
- **Budget**: four engines playing together, plus reverb, distortion and compressor, under 35% of one core on a MacBook Air M1 and under 70% on a Pixel 9a. Measure with a node benchmark.

### 4.2 The voice

Signal flow, per engine:

```
OSC A (wavetable) ─┐  ← cross-FM →  ┌─ OSC B (wavetable)
                   └──────┬─────────┘
NOISE ────────────────────┤
CLICK (generated) ────────┤ (a share of the click can bypass the filters)
                          ▼
                AMP ENVELOPE → DRIVE → FILTER 1 (LP ↔ BP ↔ HP) → FILTER 2 (COMB ↔ VOWEL) → LEVEL · TRIM · PAN → dry + REVERB send
```

Modulation: PITCH ENV is wired to pitch (its AMOUNT knob). The three general sources, **MOD ENV**, **LFO** and **VELOCITY**, can reach **any continuous sound parameter** through a continuous amount per source and destination (zero = no effect), set in that knob's modulation popup (2.2), never through a destination menu. Not modulatable: TABLE (a reference), NOISE SEED (it is read at note start; velocity may still move it), and the OUTPUT controls (level, pan, send, trim are the mix, not the sound).

- Amounts are stored like any parameter: normalised -1..+1 and glided, with ids of the form `<source>><destination>` (`lfo>cutoff`, `vel>decay`, `env>pos_a`). A sound stores only the amounts that aren't zero, and a missing amount is zero, so adding destinations later never breaks a sound (8).
- Each amount maps to the destination's units through a depth set per destination in the schema (for example: pitch ±24 st from the LFO; cutoff ±96 st from MOD ENV, ±48 st from the LFO and VELOCITY; a 0..1 parameter by up to its whole range). Modulation adds in the normalised domain before the destination's curve, and the sum is clamped to the parameter's range, so a frequency moves in pitch and a time in log time.
- **MOD ENV** is unipolar (0 at the end of its decay); the amount scales and signs it. **LFO** is bipolar. **VELOCITY** is centred on velocity 100: harder hits move by +amount, softer by up to -amount (so at velocity 100 a sound plays as set, which auto level and the rating mode rely on). VELOCITY is read once at note start; a destination it moves is held for the note.
- **Each amount is a gate of nothing but itself** (7.2).
- The engine applies modulation only to destinations with a non-zero amount, so an unmodulated sound costs no more; destinations read per sample where they are audio-rate safe (pitch, FM depth, positions, cutoff, comb pitch), per block of 16 samples elsewhere, glided so nothing zippers.
- The schema marks for each destination the depth per source and which sources it takes, and the randomisers use a **curated set** of routes (7.2 and 6.4): the useful ones a percussion sound reaches for, listed below. Johnny can still set any route by hand.

Parameters (labels are suggestions; ranges in real units; "gate" marks the level that turns a part off, see 7.2):

**OSC A**
- TABLE: which wavetable (a reference, see 4.3; morphs by crossfade, see 7.3)
- POSITION 0..1: where in the table (frames interpolated, so the sweep is smooth)
- TUNE -48..+48 semitones from the key's base pitch (C at MIDI 60 = middle; each key's sound carries its own tune, keys don't transpose)
- FINE -100..+100 cents
- LEVEL 0..1 (**gate**)

**OSC B**: TABLE, POSITION, LEVEL (**gate**) as A; RATIO: B's pitch relative to A, 0.25 to 16 as a continuous multiplier (the knob may show soft labels at whole ratios, but never snaps); DETUNE -100..+100 cents; TRACK 0..1 (1 = B follows the pitch envelope like A, 0 = B holds a fixed pitch: the source of inharmonic metal).

**FM**
- A > B 0..1 (**gate**): A modulates B's phase
- B > A 0..1 (**gate**): B modulates A's phase (both together = cross-FM, which must stay stable, never blow up)
- (FM that decays with the attack is MOD ENV on A > B and B > A, set in their popups; it was a separate FM ENV knob)

**NOISE**
- LEVEL 0..1 (**gate**)
- COLOUR -1..+1: dark (low-passed) through white to bright (high-passed), continuous tilt
- DECAY: the noise's own decay, as a share of the amp decay (0.1x to 2x), so a snare's rattle and body can last differently
- SEED 0..1: picks the noise sequence (morphs by crossfading two seeds at the halfway point is acceptable: it is noise)

**CLICK** (generated, never sampled)
- LEVEL 0..1 (**gate**)
- SHAPE 0..1: a continuous path from a single pulse, through a short pitch chirp (falling sine sweep), to a short noise burst
- TONE 20 Hz..16 kHz: the centre of the click's energy (for a pulse: its low-pass; for the chirp: its start frequency; for the burst: its band)
- LENGTH 0.2..30 ms
- DIRECT 0..1: how much of the click skips the filters and goes straight to the amp (a kick's beater click often wants to stay bright)

**AMP**
- ATTACK 0..200 ms (0 must not click: use a minimal ramp of a few samples)
- HOLD 0..500 ms
- DECAY 5 ms..8 s
- CURVE -1..+1: from linear-ish to steep exponential
- REPEAT 0..8 (continuous: the whole part is the number of retriggers, the fraction is the level of the last one, so it morphs smoothly) and SPACING 1..80 ms: claps and flams. Repeats restart the envelopes, not the oscillator phase

**PITCH ENV**
- AMOUNT -48..+96 semitones (**gate**)
- DECAY 1 ms..2 s
- CURVE -1..+1

**MOD ENV** (a source: its amounts are in the popups)
- DECAY 1 ms..4 s, CURVE -1..+1
- curated routes: A > B, B > A (FM at the attack), POS A, POS B, CUTOFF (±96 st), FILTER 2 PITCH (±48 st)

**LFO** (a source, free running per note, restarts at note start; its amounts are in the popups)
- RATE 0.05 Hz..2 kHz (audio rate for growls and metallic buzz)
- SHAPE 0..1: sine → triangle → saw → square → smooth random, continuous
- curated routes: TUNE (±24 st), POS A, POS B, CUTOFF (±48 st), A > B, B > A, OSC A LEVEL (tremolo)

**VELOCITY** (a source, no knobs of its own: velocity ignored until a popup sets an amount)
- curated routes: AMP DECAY, PITCH ENV AMOUNT, CUTOFF (±48 st), A > B, B > A, CLICK LEVEL. Loudness by velocity is the key's level and is always on (as now); a VELOCITY amount on a gate such as OSC A LEVEL makes one part louder than the rest on hard hits.

**DRIVE** (before the filter): AMOUNT 0..1 (0 = clean, unity), a smooth saturation with its level compensated, so turning it up changes the tone more than the loudness.

**FILTER 1**, the morph filter (section 4.4)
- MORPH 0..1: LP (0) → BP (0.5) → HP (1), continuous
- CUTOFF 20 Hz..20 kHz
- RESONANCE 0..1 (up to the edge of self-oscillation, never unstable)
- TRACK 0..1: cutoff follows the sound's pitch (with the pitch envelope)

**FILTER 2** (one heading for the comb and the vowel filter; Johnny, 2026-11-18: "you can choose either")
- MIX 0..1 (**gate**)
- COMB > VOWEL 0..1: which of the two it is, as a **continuous blend**, not a switch. 0 is the comb (a tuned resonator), 1 the vowel filter, and between them both run in parallel and crossfade (equal power, level matched within ±2 dB), so two sounds on different sides still morph. The knob shows soft labels: "COMB", "VOWEL", "COMB 70 / VOWEL 30".
- PITCH 20 Hz..8 kHz: the comb's pitch; for the vowel filter it moves all formants by the interval from 500 Hz, held within ±12 semitones
- TRACK 0..1: follow the sound's pitch (both)
- RESONANCE -0.98..+0.98: the comb's feedback (positive: all harmonics, a tube or string; negative: odd harmonics, hollow; level compensated, so high feedback doesn't jump in loudness). For the vowel filter, how sharp the formants are (its size; the sign doesn't matter)
- DAMP 0..1: the comb's low-pass inside the loop, so the ring darkens as it decays; for the vowel filter, the upper formants softened
- VOWEL 0..1: a continuous path through five vowels (A, E, I, O, U), formant frequencies, widths and levels interpolated between neighbours (use published average formant data). Only the vowel side uses it; it is drawn dim while COMB > VOWEL is at 0

**OUTPUT (per key, part of the mix, not the sound)**: LEVEL, PAN, REVERB send, TRIM (from auto level). These are not randomised by ALTER and are kept by new sounds, as in LXR-AFX.

That is 47 knobs on the grid (the modulation amounts, which were 17 more knobs, are in the popups). The grid has 15 columns: 13 for the sound, then FX SEND and LEVEL. Four rows, with a section never split across rows:

| row | sections (knobs) |
|---|---|
| 1 | OSC A (5) · OSC B (6) · FM (2) |
| 2 | NOISE (4) · CLICK (5) · PITCH ENV (3) · DRIVE (1) |
| 3 | AMP (6) · FILTER 1 (4) · MOD ENV (2) · one spare cell |
| 4 | FILTER 2 (7) · LFO (2) · OUTPUT PAN (1) · three spare cells |

Every knob sits on the shared column positions, lined up with the knobs above and below. Fewer rows than the five planned before means bigger knobs at 1280 x 700 scaled. Hide nothing; if it doesn't fit, discuss with Johnny before adding pages.

### 4.3 Wavetables

- **A table** is up to 256 frames of one cycle each, stored at 2048 samples per frame. Playback interpolates between neighbouring frames by POSITION and reads each frame band-limited: keep a set of copies per octave with the harmonics above Nyquist removed (made with an FFT when the table is built), and crossfade between neighbouring octave copies so a pitch sweep never steps.
- **Built-in tables are generated from maths** at start-up (or in a Worker), never shipped as samples. A starting set, each a smooth sweep from frame 0 to the last:
  1. BASIC: sine → triangle → saw → square → narrow pulse
  2. HARMONICS: sine, then harmonics added one at a time
  3. ODD: odd harmonics building up (hollow, woody)
  4. PULSE: pulse width 50% down to 2%
  5. SYNC: the sound of hard sync at ratios rising from 1 to 8, built band-limited
  6. FOLD: a sine wavefolded with rising gain
  7. BEND: a sine with rising phase distortion, towards a resonant peak
  8. FORMANT CYCLES: a harmonic spectrum with a peak sweeping up through it
  9. SPARSE: seeded sets of a few high harmonics (bells and metal, especially with FM)
  10. GRIT: seeded random spectra from smooth to rough (noisy metal when played high)
  11. STEPS: a sine quantised to fewer and fewer levels
  Each built-in table has a stable id (`builtin:basic` …) and its generator is fixed, so a sound sounds the same in every version. Changing a generator means a new id.
- **User tables from WAV files** (SETTINGS > WAVETABLES: LOAD, a list with name, frame count and a small drawing, DELETE):
  - Accept 8/16/24/32-bit integer and 32-bit float WAV, any sample rate, mono or stereo (summed).
  - Frame size: read a frame-size marker chunk if the file has one (some wavetable editors write one), else 2048 if the length divides by it, else ask with a choice of 256, 512, 1024, 2048, 4096 or "the whole file is one cycle". Resample each frame to 2048. Up to 256 frames.
  - Remove DC per frame, normalise the table as a whole, and make the frame edges join (a short crossfade where a frame's end doesn't meet its start).
  - Store the decoded table (float frames, name, content hash) in IndexedDB. A sound refers to a user table by its hash; a preset or library export that uses user tables embeds them (base64) so the file works on another computer.
  - A sound whose table is missing plays BASIC instead and the key shows "table missing".

### 4.4 The morph filter: no clicks, no level jumps

The LXR-AFX filter-type knob clicked and jumped in level between types. Treat these as requirements:

- One filter state, with the LP, BP and HP outputs taken from it at once, and MORPH crossfading between them along an equal-power or level-matched path. Changing MORPH, CUTOFF or RESONANCE at any speed, during a note, must not click (a zero-delay-feedback state-variable filter, as in the published topology-preserving designs, does this; modulating its coefficients per sample is fine).
- **Matched level across the morph**: with pink noise in, at any cutoff from 100 Hz to 8 kHz and any resonance up to 0.7, the output loudness (K-weighted) at every MORPH position stays within ±1.5 dB of the LP end. Compensate with a gain curve over MORPH and RESONANCE, worked out by measurement and stored as a small table, not by ear.
- The BP point is a normalised band-pass (its peak at unity), not one whose level falls as resonance rises.
- Resonance up to its top must stay stable at every cutoff, including with the drive before it and the cutoff at 20 kHz at high sample rates.
- The same rules apply to FILTER 2: RESONANCE on the comb side (level compensated, no jump when it crosses zero), VOWEL (smooth between vowels, level matched within ±2 dB) and COMB > VOWEL (the crossfade level matched within ±2 dB).

---

## 5. FX and master

Order: every engine's dry output and the reverb return → DISTORTION → COMPRESSOR → OUTPUT LEVEL → the speakers.

### 5.1 Reverb (new)

- One stereo send reverb, fed by each key's REVERB send and returned at unity. Johnny liked the old one: aim for the same kind of sound, written new. A dense, smooth, slightly dark room-to-hall reverb with early reflections, whose two sides are equally loud and unlike each other so the tail spreads between the speakers.
- Knobs: SIZE, DECAY, TONE (damping, dark to bright), EARLY (early reflection level), plus new PRE-DELAY (0..100 ms) and WIDTH.
- Build it from a published design (a feedback delay network, or an allpass-loop plate from the literature), with slow modulation in the loops to avoid metallic ringing. No click when any knob moves; SIZE changes glide.

### 5.2 Distortion

- `sound/dirt.js` copied as is, and its UI from LXR-AFX (DIRT section on the FX + MASTER tab: ON, PREGAIN, FILTER and swap, XOVER, GAIN, CLIP (diode / LED), BASS, TONE, DIRTY, CLEAN; SIDECHAIN: ON, SOURCE (the mix or ENGINE 1 to 4), filter type, FREQ, SENS, DECAY, the ENV meter, direction and target). Off until ON is pressed.
- Its CLIP, filter swap, SC filter type, direction and target are switches; that's fine on the master (the master isn't part of a sound and isn't morphed).

### 5.3 Compressor (rewritten fresh)

- A feed-forward, soft-knee compressor on the stereo master (linked detection), with THRESHOLD (0 to -40 dB, 0 = off), RATIO (1:1 to 20:1), ATTACK (1 to 100 ms), RELEASE (10 to 1000 ms), KNEE (0 to 24 dB), MAKEUP (0 to +24 dB) and a gain-reduction meter. Same knobs as LXR-AFX, so the UI carries over.
- Smooth gain: no zipper on fast attacks, no click when THRESHOLD crosses into or out of off.

### 5.4 Output

- OUTPUT LEVEL 0..100%, then a gentle safety limiter (no overs, no clicks). Peak meters as now.

---

## 6. Sounds, the rating mode and the randomisers

There are no kits. METAMORF's sounds come from Johnny: the app generates sounds, he tags and keeps or bins them, and the keepers become the factory library that every randomiser deals from.

### 6.1 Words

- A **sound**: one key's parameters (section 4) plus a name, a group and where it came from.
- The **library**: the kept sounds. The **factory library** ships with the app as `sounds/factory.json`; Johnny's own kept sounds are in the browser and can be exported and merged into the factory file.
- A **patch** (or preset): all 25 keys, the engine count, the effects, the master and the BPM (section 2.9).
- **Groups** (Johnny, 2026-11-18: "I don't want too many groups … this leaves room for kind of interesting random sounds"): four broad groups by register, not drum names, so a sound that is neither a kick nor a snare still has a home:

  | id | label | roughly |
  |---|---|---|
  | `low` | LOW | kicks, low toms, booms, sub drops |
  | `mid` | MID | snares, claps, toms, body hits |
  | `midhigh` | MID-HIGH | rims, percs, blips, zaps, woodblocks |
  | `treble` | TREBLE | hats, cymbals, bells, shakers, air |

  A sound stores the group's **id**; the label is only shown. Johnny may rename the groups later: a rename changes the label only, so saved sounds, the library and presets never break. They replace the old eleven types everywhere: rating, the library, recipes, MAKE THIS KEY, the pan rule and auto level targets. The group is Johnny's call when he keeps a sound, not measured from it.

### 6.2 The rating mode

A **RATE** tab beside the engine buttons and FX + MASTER (R). On the same grid as the rest of the screen.

- It shows one **candidate** sound on the normal knob grid, and plays it as soon as it appears. **Space**, the pad, any key on the strip and any MIDI key play it (the whole keyboard plays the candidate while RATE is open; velocity counts).
- **Group buttons** (LOW, MID, MID-HIGH, TREBLE, with the shortcuts 1 2 3 4 shown on them): one press keeps the candidate in that group, names it, adds it to the library and deals the next candidate. Before keeping, Johnny can turn any knob; the kept sound is the tweaked one.
- **BIN** (X or Backspace): throw it away and deal the next.
- **BACK**: undo the last verdict (keep or bin) and show that sound again.
- **GENERATE FROM**: WILD (FREE over each parameter's whole safe range), NEAR KEEPERS (breed or morph two kept sounds, then nudge), and a **group target** ("give me MID": generate around the kept MID sounds, or a starter recipe while there are none). Mix as it comes: mostly WILD while the library is small, more NEAR KEEPERS as it grows.
- Candidates go through the dud filter and auto level before they are shown, so every candidate is playable and about as loud as the last.
- A counter: kept per group, binned, total. **EXPORT LIBRARY** writes the library as JSON (with any user tables embedded); **IMPORT LIBRARY** merges a file. Committing an exported file as `sounds/factory.json` makes those sounds the factory library.
- Binned sounds are kept too (parameters and group target only, in IndexedDB, exportable), so a later version can learn what Johnny doesn't like. Nothing uses them yet.
- **On the phone (Johnny, 2026-11-18: "how I want the phone view to be for generating and evaluating drum hits")**: the phone's main job is rating. A **RATE** screen, reached from the phone MENU and remembered as the phone's view:
  - A big **PLAY** pad (the top half of the screen) plays the candidate, velocity from where it is touched (harder near the bottom), several taps in a row allowed.
  - Under it, the four **group** buttons in a 2 x 2 grid, each a big target: a tap keeps the candidate in that group and deals the next one, which plays at once.
  - **BIN** and **BACK** side by side, then a one-line **GENERATE** choice (WILD, NEAR KEEPERS, or a group target), the counter (kept per group, binned) and the message line.
  - The candidate's name and where it came from at the top. No knobs: a candidate is kept or binned as it is. The library, export and import stay on the big screen; the phone's keepers go into the same browser library.
  - The pads screen of 2.12 stays, reached from MENU (PADS / RATE).

### 6.3 Library browser

- In the RATE tab, a **LIBRARY** list: filter by group, play on hover-free click, rename, move to another group, delete (X then SURE?), and **PUT ON KEY** (the sound onto the key last played, undoable).

### 6.4 The randomisers, against the library

Every one keeps locked keys, closed padlocks and the key's send, applies the pan rule (2.5) and auto level, skips duds, and says in the message line what it made and what it kept.

- **LIBRARY**: a kept sound as it is (a different one from the key's current sound).
- **BREED**: two kept sounds crossed section by section (OSC A, OSC B with FM, NOISE, CLICK, AMP with PITCH ENV, DRIVE with FILTER 1, FILTER 2, and the modulation: MOD ENV and LFO settings with every amount), at least one section from each parent, then every parameter nudged a little (6% of its range). Prefer parents of the same group.
- **MORPH**: two kept sounds blended at a random point between 25% and 75%, by the morph rules of section 7.
- **STYLE**: every parameter takes a value that some kept sound of the same group has for it (each parameter from a different sound).
- **FREE**: every parameter anywhere in its safe range. The wildest.
- **RECIPE / MAKE THIS KEY**: a sound of a named group. With 5 or more keepers of that group, the recipe is learned: each parameter drawn between the 10th and 90th percentile of the keepers of that group (correlated parameters such as tune and pitch-env amount drawn from the same keeper, then nudged). With fewer, a **starter recipe** written for the new engine (hand-tuned ranges for each group, each wide enough for several kinds of sound: LOW spans kicks, booms and low toms; TREBLE spans short and long noise and FM metal through the HP end of the filter, bells; and so on). ANY picks a group at random. A group button is never greyed out, since a starter recipe always exists.
- **ALTER / ALTER KEY / ALTER ALL**: nudge each parameter around the sound's home by the HOW MUCH amount, within the parameter's safe range (WILD: its whole range). ALTER doesn't move OUTPUT (level, pan, send) and doesn't change a TABLE (it may move POSITION). It nudges the modulation amounts a sound has, and never adds a route it doesn't have (WILD may add one from the curated set).
- **Safe ranges**: each parameter has a "percussion-safe" range in the schema, the range FREE and ALTER use. Start with sensible ranges by hand, then, once the library has 100 or more sounds, tighten them to what the keepers use (plus a margin).

---

## 7. Morphing

Morphing between sounds is a core goal. Everything in section 4 exists so that any two sounds blend smoothly.

### 7.1 Features at launch (carried over)

In the RANDOM menu, under INIT PATCH, with captions ("LOWEST KEY TO HIGHEST, STEP BY STEP"):

- **MORPH KEYS**: keeps the lowest and highest keys' sounds (set them first; an end with no sound of its own gets a library sound), and fills every key between with a step of the way from one to the other, across every engine's zone (the whole keyboard).
- **NEW ENDS**: a LOW sound on the lowest key and a sound of another group (MID, MID-HIGH or TREBLE) on the highest, then MORPH KEYS. Press again for another pair. (Johnny: "kicks at the bottom and other stuff at the top".)
- **LOW > TREBLE** (was KICK > HAT): a LOW, a MID, a MID-HIGH and a TREBLE sound on four evenly spread keys, each stretch between neighbours morphed.
- All three keep locked keys and closed padlocks, keep the sends, clamp pan to the pan rule, apply auto level, and are undoable.

### 7.2 The blend rules

- **Every parameter slides**: interpolate in the normalised domain. Modulation amounts are parameters like any other: an amount that one sound has and the other doesn't slides from its value to zero (a missing amount is zero), so a morph fades a route in or out (so frequencies and times move evenly in pitch and in log time, not in Hz or ms).
- **A part that is off on one side borrows from the side where it's on.** If a gate is zero in sound A (OSC A or B LEVEL, A > B, B > A, NOISE LEVEL, CLICK LEVEL, PITCH ENV AMOUNT, FILTER 2 MIX, each modulation amount), that part's other settings are taken from sound B along the whole morph, so its gate fades it in with B's settings rather than passing through settings neither sound has. Each gate lists its dependents in the schema (for example NOISE LEVEL gates COLOUR, DECAY and SEED; FILTER 2 MIX gates COMB > VOWEL, PITCH, TRACK, RESONANCE, DAMP and VOWEL).
- **OUTPUT** (level, pan, send, trim) is not morphed by MORPH KEYS: each key keeps its own send, pan follows the pan rule, trim comes from auto level.

### 7.3 Tables

- A morph between two sounds whose oscillators use different tables plays both tables at once, at the same phase, crossfaded (equal power) by the morph position. So the engine's oscillator holds a **table pair and a blend** internally: a normal sound has one table and blend 0; a morphed sound may have two. The UI shows "BASIC / FOLD 40". ALTER leaves the pair alone.

### 7.4 Next, after launch (design for it now)

- A live **MORPH** control: a knob (and a CC) that glides the current key, or the whole patch, between two sounds (or two patches) while playing. The engine must take continuous parameter changes during a note without clicks (4.1), so this needs no engine change.
- Morph by velocity (soft hits one sound, hard hits another) is a natural extension of the same blend.

---

## 8. Storage formats

All new, with no ties to LXR-AFX's.

- **Sound** (JSON): `{ v: 1, name, group: 'low' | 'mid' | 'midhigh' | 'treble', from, params: { id: number, ... }, mod: { 'lfo>cutoff': number, ... }, tables: { a: ref, a2?: ref, ab?: number, b: ref, ... } }`. Parameters by id (never by position), normalised floats. Unknown ids are ignored; missing ids take their default, so adding parameters later never breaks a sound. `mod` holds only non-zero amounts (normalised -1..+1); a missing amount is zero.
- **Patch / preset** (JSON): `{ v: 1, name, engines, keys: [ by place in layout: { sound, edits, home, lock, out: { level, pan, send, trim } } ], fx: { reverb, dirt, comp, out }, bpm }`.
- **Export files**: `{ app: 'metamorf', kind: 'presets' | 'library', version: 1, items: [...], tables: { hash: base64 } }`.
- **localStorage**: the live state (`metamorf-v1`), presets (`metamorf-presets-v1`), colours (`metamorf-colours`). **IndexedDB**: user tables, the library, the bins.
- Sanitise every import (names, labels, ranges, sizes), since messages are shown as HTML.

---

## 9. Tests and acceptance

Node tests for the engine (no browser), Playwright for the page. Each new part comes with its test.

- **Continuity**: for every parameter, sweep it end to end over 50 ms during a sustained note (and over 2 s), and check for clicks: no sample-to-sample step larger than the steady signal's own largest step plus a small margin, and no burst in the high-passed difference signal. Same for a morph between two random sounds, and for retriggers.
- **Filter level match** (4.4): pink noise, MORPH swept, cutoff 100 Hz to 8 kHz, resonance 0 to 0.7: within ±1.5 dB of the LP end. FILTER 2: comb resonance across zero, across vowels, and COMB > VOWEL end to end: within ±2 dB.
- **Stability**: random sounds (FREE, 10,000 of them, fast offline) never produce NaN, infinity, DC over -40 dB or output over +6 dBFS before the master.
- **Repeatability**: the same sound and velocity render bit-identically twice.
- **Morph**: blends at 0 and 1 equal the end sounds exactly; the gate rule holds; table pairs crossfade.
- **Wavetables**: built-in tables are identical across runs; aliasing of a saw swept to 10 kHz stays under -60 dB; WAV import of each bit depth and frame-size case, including a bad file.
- **Auto level**: every factory sound lands within ±1 dB of its target after trim.
- **Performance**: a node benchmark of four engines, reverb, distortion and compressor, against the budget in 4.1.
- **Page** (`test/shots.mjs`, adapted): laptop sizes 1440 x 900, 1280 x 800, 1440 x 760, 1280 x 700 and phone 412 x 915, 412 x 780, 360 x 640 with touch. Every knob on the shared column positions, nothing scrolls, the longest status message fits, and the flows: dice, alter, lock, padlocks, copy/paste, undo, presets save/load/export/import, ENGINES 1 to 4, MORPH KEYS, RATE keep/bin/back, WAV load, phone pads with two fingers.

---

## 10. Build order

Each step ends live on GitHub Pages, with its tests, small enough for Johnny to try.

1. **Repo and shell**: the files of 3.1 fetched, renamed to METAMORF, with a stub engine (a plain decaying sine) so the page, keys, MIDI, strip, menus, colours, presets and phone all work. Fresh storage keys.
2. **Engine core**: the instrument, the worklet, the Worker for offline renders; OSC A and B on the BASIC table, AMP, PITCH ENV, LEVEL/PAN; continuity and repeatability tests.
3. **Wavetables**: the built-in generators, band-limiting, POSITION; then WAV loading (SETTINGS > WAVETABLES).
4. **FM, noise, click, drive.**
5. **Filters**: FILTER 1 (the morph filter) with its level-match table, then FILTER 2: the comb, the vowel filter and the blend between them.
6. **Modulation**: MOD ENV, LFO, VELOCITY as sources routed to any parameter by amount, REPEAT; tests that an unmodulated sound costs no more and that every route glides without clicks.
7. **The parameter schema and the knob grid** for the whole voice, on the grid at every size, with the **modulation popup** (right-click), its faders, the modulation marks on the knobs, and page tests for opening, dragging, double-click, CLEAR, closing and padlocks.
8. **FX and master**: the reverb, the copied distortion, the new compressor, the output limiter, the FX + MASTER tab.
9. **Auto level and the dud filter.**
10. **RATE mode and the library**, with starter recipes for generating. Johnny starts rating here; his exports become `sounds/factory.json`.
11. **Randomisers on the library**: LIBRARY, BREED, MORPH, STYLE, FREE, RECIPE, MAKE THIS KEY, ALTER, INIT PATCH, padlocks, the pan rule.
12. **Morph keys**: MORPH KEYS, NEW ENDS, LOW > TREBLE, table pairs.
13. **Phone screen** brought up to date, with the phone RATE screen (6.2).
14. **Polish**, then the live MORPH control (7.4).

---

## 11. Open questions for Johnny

1. **Licence** for the new repo.
2. **Default engine count**: this spec assumes **4** (6/6/6/7) since engines no longer have types. 3 is the LXR-AFX default.
3. **The Bass Station 2 knobs** that drove the echo send (LFO 1 speed, CC 18): what should they do now? Suggestion: CC 18 → filter MORPH, CC 5 → reverb send.
4. **Rating shortcuts**: one key per type, so a sound can be kept with one press (suggestion: Q W E R T Y U I O P for the first ten types, [ and ] for the last two, X to bin). Is one press per sound right, or does Johnny want a star rating as well?
5. **Is the whole keyboard playing the candidate** in RATE mode right, or should keys play their own sounds with the candidate on Space only?
6. **Pages or one screen**: about 60 knobs fit at 1440 x 900 in five rows; at 1280 x 700 the screen scales down. If that's too small, are two knob pages acceptable, or should some parameters move?

### Answers (2026-11-18)

Johnny accepted every suggested answer: 1. no licence for now (all rights reserved); 2. four engines; 3. CC 18 → filter MORPH, CC 5 → reverb send; 4. one press per sound, no star rating (the keys are now 1 2 3 4 for the four groups, X bins); 5. the whole keyboard plays the candidate in RATE; 6. one screen, scaled at 1280 x 700, and Johnny sees it before any pages are added.

**Modulation popup (2026-11-18, Johnny):** "right click a knob and a modulation popup appears, with lfo velocity envelope etc as sources with faders setting the amount for each". Folded into 2.1, 2.2, 4.2, 6.4, 7.2, 8 and 10: the 17 modulation amount knobs leave the grid, any continuous sound knob can be a destination, and the grid becomes four rows of 13 instead of five.

**Groups (2026-11-18, Johnny):** "I don't want too many groups … something like low, mid, mid-high, treble"; "I might change those names at some point". Four groups by register replace the eleven types everywhere (6.1), stored by id so a rename never breaks a sound. The phone becomes the place for generating and rating hits (6.2).

**FILTER 2 (2026-11-18, Johnny):** "The formant and comb filter can be under one heading, filter 2 … and there can be options in there. You can choose either." The choice is the continuous COMB > VOWEL knob, so sounds still morph; the two filters share PITCH, TRACK, RESONANCE and DAMP, plus VOWEL. FILTER becomes FILTER 1. 47 knobs.
