/**
 * nexus-pet.js — "Pip", the Nexus desk pet.  v3 — behaviour engine
 *
 * Not a CSS animation loop. Pip runs a small creature simulation:
 *
 *  · POSE      one RAF loop drives springs (body, lean, squash, wings, gaze)
 *  · PROCEDURAL breathing/sway = sum of sines at irrational ratios, so the
 *              motion never repeats identically — the key to killing "loopiness"
 *  · DRIVES    energy · boredom · affection · patience decay and grow over time
 *              and bias which idle behaviour is chosen next
 *  · SCHEDULER weighted random picks with per-action cooldowns + Poisson blinks
 *  · REACTIONS typing, sending, thinking, working, success, failure
 *  · INTERACTION live gaze tracking, hover, petting, click, spam-click moods
 *
 * Reference points: Tamagotchi/Pou need-loops, Finder's Dock genie easing,
 * game-AI utility scoring, and Disney squash-&-stretch timing.
 */
'use strict';

(function NexusPetModule() {
  const KEY = 'skylark-pet-enabled';
  const isEnabled = () => localStorage.getItem(KEY) !== 'false';

  /* ─────────────── SPRITE (16 × 16) ───────────────
     The wings (W) now live in the two OUTER columns, outside the body
     outline, so rotating them from the shoulder reads as real arm
     movement — waving, flapping, reaching. 'b' adds blush cheeks. */
  const SPRITE = [
    '......oooo......',
    '....oggggggo....',
    '...oggggggggo...',
    '..oggggggggggo..',
    '..owwwGGGGwwwo..',
    '.owSSSwGGwSSSwo.',
    '.owSSSwGGwSSSwo.',
    '.owbwwwyywwwbwo.',
    '.owwwwwyywwwwwo.',
    'WWowwwwwwwwwwoWW',
    'WWowwwwwwwwwwoWW',
    'WWowwwwwwwwwwoWW',
    '.WowwwwwwwwwwoW.',
    '..owwwwwwwwwwo..',
    '...oowwwwwwoo...',
    '....FFo..oFF....'
  ];
  const PALETTE = {
    o: '#0c0c0f', g: '#7c7c86', G: '#5f5f68', w: '#eff0f4',
    S: '#ffffff', y: '#f5b93f', W: '#6a6a74', F: '#f5b93f',
    b: '#f0a2b0'
  };
  // Eye sockets are 3 × 2 white areas; pupils are drawn separately so they can
  // actually look around inside the socket, and eyelids close over the top.
  const EYE = { lx: 3, rx: 10, y: 5, w: 3, h: 2, pupil: 1.6 };
  // Free travel inside the socket, so a pupil can never slide off the white
  const GAZE_X = (EYE.w - EYE.pupil) / 2;          // ±0.7
  const GAZE_Y = (EYE.h - EYE.pupil) / 2;          // ±0.2

  function buildSVG() {
    const W = SPRITE[0].length, H = SPRITE.length;
    const g = { body: [], eyes: [], wingL: [], wingR: [], beak: [], feet: [] };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ch = SPRITE[y][x];
        if (ch === '.') continue;
        const fill = PALETTE[ch];
        if (!fill) continue;
        const r = `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
        if (ch === 'S') g.eyes.push(r);
        else if (ch === 'y') g.beak.push(r);
        else if (ch === 'F') g.feet.push(r);
        else if (ch === 'W') (x < W / 2 ? g.wingL : g.wingR).push(r);
        else g.body.push(r);
      }
    }
    // Pupils sit inside each socket and translate with the gaze. Slightly larger
    // than one pixel so the eyes read clearly at this size.
    const ps = EYE.pupil;
    const pupil = (sx) => {
      const x = (sx + (EYE.w - ps) / 2).toFixed(2);
      const y = (EYE.y + (EYE.h - ps) / 2).toFixed(2);
      return `<rect x="${x}" y="${y}" width="${ps}" height="${ps}" rx="0.32" fill="#0c0c0f"/>`
           + `<rect x="${(+x + ps * 0.14).toFixed(2)}" y="${(+y + ps * 0.12).toFixed(2)}" width="${(ps * 0.3).toFixed(2)}" height="${(ps * 0.3).toFixed(2)}" rx="0.16" fill="#ffffff" opacity="0.9"/>`;
    };
    const pupils = pupil(EYE.lx) + pupil(EYE.rx);
    // Eyelids: a dark line across the socket base, revealed as the eyes close.
    const lid = (x) => `<rect x="${x}" y="${EYE.y + EYE.h - 1}" width="${EYE.w}" height="1" fill="#0c0c0f"/>`;
    const lids = lid(EYE.lx) + lid(EYE.rx);

    return `
      <svg class="pet-svg" viewBox="0 0 ${W} ${H}" width="${W * 3}" height="${H * 3}"
           shape-rendering="crispEdges" aria-hidden="true">
        <g class="pet-body">${g.body.join('')}</g>
        <g class="pet-wing pet-wing-l">${g.wingL.join('')}</g>
        <g class="pet-wing pet-wing-r">${g.wingR.join('')}</g>
        <g class="pet-beak">${g.beak.join('')}</g>
        <g class="pet-eyes">${g.eyes.join('')}</g>
        <g class="pet-pupils">${pupils}</g>
        <g class="pet-lids">${lids}</g>
        <g class="pet-feet">${g.feet.join('')}</g>
      </svg>`;
  }

  /* ─────────────── SIMULATION STATE ─────────────── */
  const S = {
    // pose: value / target pairs driven by springs
    y: 0, ty: 0, rot: 0, trot: 0, sx: 1, tsx: 1, sy: 1, tsy: 1,
    eyeX: 0, teyeX: 0, eyeY: 0, teyeY: 0,
    wl: 0, twl: 0, wr: 0, twr: 0,
    blink: 1, tblink: 1,
    // drives (0..1)
    energy: 1, boredom: 0, affection: 0.2, patience: 1,
    // bookkeeping
    mood: 'calm', action: null, actionUntil: 0, nextIdle: 0, nextBlink: 0,
    asleep: false, lastInteract: 0, clicks: 0, clickWindow: 0,
    gazeTarget: null, hovering: false, phase: Math.random() * 1000
  };
  const COOLDOWN = {};       // per-action cooldown timestamps
  const ph0 = (t) => t + S.phase;   // per-instance phase so two pets never sync

  /**
   * Anchors the body-level bubble just above the pet and clamps it inside the
   * viewport, so a long thought can never be cut off by an edge or a container.
   */
  function placeBubble() {
    if (!bubble || !pet) return;
    // Measure after paint so width reflects the new text
    requestAnimationFrame(() => {
      if (!bubble || !pet) return;
      const p = pet.getBoundingClientRect();
      // offsetWidth/Height ignore the enter transform (scale/translate), so the
      // measurement is stable even while the bubble is still animating in.
      const bw = bubble.offsetWidth || 120;
      const bh = bubble.offsetHeight || 32;
      const M = 10;                                  // viewport margin
      const cx = p.left + p.width / 2;               // pet centre
      let left = cx - bw * 0.62;
      left = Math.max(M, Math.min(left, window.innerWidth - bw - M));
      let top = p.top - bh - 10;
      let side = 'top';
      if (top < M) { top = p.bottom + 10; side = 'bottom'; }  // flip below if no room above
      bubble.style.left = Math.round(left) + 'px';
      bubble.style.top = Math.round(top) + 'px';
      bubble.dataset.side = side;
      // Tail x-offset, clamped so the arrow always stays on the bubble body
      const tail = Math.max(14, Math.min(cx - left, bw - 14));
      bubble.style.setProperty('--tail-x', Math.round(tail) + 'px');
    });
  }

  // Real wingbeats are asymmetric: a fast, powerful downstroke and a slower
  // recovery upstroke. Skewing the sine gives that snap instead of a soft wobble.
  function beat(x) {
    const s = Math.sin(x);
    return Math.sign(s) * Math.pow(Math.abs(s), 0.55);
  }

  let host = null, pet = null, bubble = null, anchor = null, raf = 0;
  const now = () => performance.now() / 1000;

  /* ─────────────── SPEECH ─────────────── */
  const LINES = {
    greet:    ['hi!', 'hey!', 'yo!'],
    watching: ['ooh…', 'go on…', '👀'],
    excited:  ['nice one!', 'ooh big!', 'love it'],
    sent:     ['on it!', 'here we go', 'gotcha'],
    thinking: ['thinking…', 'hmm…', 'one sec'],
    working:  ['digging…', 'hunting…', 'searching…'],
    joy:      ['got them!', 'yesss!', 'all done!'],
    sad:      ['aw…', 'hmm…', 'try again?'],
    pet:      ['*purr*', '♥', 'hehe'],
    giggle:   ['hehe!', 'hee hee', 'that tickles!', 'stop it 😆'],
    shy:      ['*hides*', 'too much!', 'eep!'],
    fly:      ['wheee!', 'almost!', 'i can fly!', '*flap flap*'],

    sleepy:   ['zzz…'],
    wake:     ['oh! hi', '*yawn*']
  };
  function say(kind, hold = 2000) {
    if (!bubble) return;
    // A live pipeline report always outranks idle chatter.
    if (S.reportUntil && now() < S.reportUntil) return;
    const pool = LINES[kind];
    if (!pool) return;
    bubble.classList.remove('pet-report', 'pet-tip');
    bubble.textContent = pool[(Math.random() * pool.length) | 0];
    bubble.classList.add('show');
    placeBubble();
    clearTimeout(bubble.__t);
    bubble.__t = setTimeout(() => bubble.classList.remove('show'), hold);
  }

  // Verbatim live status from the lead pipeline — stays until superseded.
  function report(text, step) {
    if (!bubble) return;
    S.reportUntil = now() + 12;
    bubble.classList.remove('pet-tip');
    bubble.classList.add('show', 'pet-report');
    bubble.textContent = text;
    placeBubble();
    if (typeof step === 'number' && step > 0) bubble.dataset.step = String(step);
    clearTimeout(bubble.__t);
    bubble.__t = setTimeout(() => {
      bubble.classList.remove('show', 'pet-report');
      S.reportUntil = 0;
    }, 9000);
  }

  /* ─────────────── ACTION LIBRARY ─────────────── */
  // Each action nudges targets over its lifetime; the spring solver does the rest.
  const ACTIONS = {
    glance:  { dur: 1.1, cd: 2,  run(t) { S.teyeX = t < .5 ? -1 : 1; S.trot = t < .5 ? -2 : 2; } },
    tilt:    { dur: 1.4, cd: 6,  run(t) { S.trot = Math.sin(t * Math.PI) * 9; S.teyeY = .4; } },
    waddle:  { dur: 1.6, cd: 7,  run(t) { S.trot = Math.sin(t * Math.PI * 3) * 7; } },
    flap:    { dur: 1.0, cd: 8,  run(t) {
                const env = Math.sin(t * Math.PI);
                const a = beat(t * Math.PI * 7) * 34 * env;
                S.twl = -a; S.twr = a;
                S.ty = -2 * Math.max(0, a) / 34;      // tiny lift on each downstroke
              } },
    hop:     { dur: .75, cd: 9,  run(t) { const k = Math.sin(t * Math.PI); S.ty = -13 * k; S.tsy = 1 + .1 * k; } },
    stretch: { dur: 1.8, cd: 22, run(t) { const k = Math.sin(t * Math.PI); S.tsy = 1 + .16 * k; S.tsx = 1 - .07 * k; S.twl = -34 * k; S.twr = 34 * k; } },
    preen:   { dur: 2.2, cd: 18, run(t) { S.trot = -13; S.teyeY = .9; S.twl = -18 + Math.sin(t * Math.PI * 8) * 12; } },
    scratch: { dur: 1.7, cd: 20, run(t) { S.trot = 8; S.twr = 20 + Math.sin(t * Math.PI * 10) * 14; } },
    yawn:    { dur: 2.0, cd: 30, run(t) { const k = Math.sin(t * Math.PI); S.tblink = 1 - .85 * k; S.tsy = 1 + .07 * k; S.trot = -5 * k; } },
    peck:    { dur: .7,  cd: 5,  run(t) { const k = Math.sin(t * Math.PI); S.ty = 3 * k; S.trot = 0; S.teyeY = k; } },
    shiver:  { dur: .9,  cd: 14, run(t) { S.trot = Math.sin(t * Math.PI * 14) * 4; } },
    wiggle:  { dur: 1.2, cd: 3,  run(t) { S.trot = Math.sin(t * Math.PI * 5) * 11; S.tsy = 1.04; } },

    // Tickled by repeated taps: squinty laughing bounces. Stays upright —
    // deliberately no full rotation, so it never reads as a tumble.
    giggle:  { dur: 1.5, cd: 2, run(t) {
                const env = Math.sin(t * Math.PI);
                const b = Math.abs(Math.sin(t * Math.PI * 5));
                S.ty  = -5 * b;
                S.tsy = 1 + .10 * b;
                S.tsx = 1 - .055 * b;
                S.trot = Math.sin(t * Math.PI * 9) * 5.5 * env;   // happy shiver only
                S.twl = -(28 + b * 26) * env;
                S.twr =  (28 + b * 26) * env;
                S.tblink = .42;                                   // squeezed-shut laugh
                S.teyeY = .18;
              } },

    // Overwhelmed by attention: tucks under its wings, then peeks back out.
    shy:     { dur: 2.3, cd: 7, run(t) {
                const cover = t < .7 ? Math.min(1, t * 5) : Math.max(0, 1 - (t - .7) / .3);
                S.twl = -104 * cover;
                S.twr =  104 * cover;
                S.tblink = 1 - .82 * cover;
                S.ty  = 2.5 * cover;
                S.trot = -3 * cover;
                S.tsy = 1 - .05 * cover;
                S.tsx = 1 + .03 * cover;
              } },

    /* ── ARM / FLIGHT VOCABULARY ── */
    // Raises one wing beside the head and waves it, like the reference art
    wave:    { dur: 2.0, cd: 4, run(t) {
                const lift = Math.min(1, t * 4) * (1 - Math.max(0, (t - .8) * 5));
                S.twl = -105 * lift + Math.sin(t * Math.PI * 7) * 17 * lift;
                S.twr = 8 * lift;
                S.trot = 4 * lift;
                S.teyeX = .5; S.teyeY = -.25;
              } },
    // Both arms up in a happy cheer
    armsUp:  { dur: 1.4, cd: 6, run(t) {
                const k = Math.sin(t * Math.PI);
                S.twl = -95 * k; S.twr = 95 * k;
                S.tsy = 1 + .07 * k; S.ty = -3 * k; S.teyeY = -.4;
              } },
    // A small polite bounce
    hopSmall:{ dur: .55, cd: 2, run(t) {
                const k = Math.sin(t * Math.PI);
                S.ty = -6 * k; S.tsy = 1 + .06 * k;
                S.twl = -22 * k; S.twr = 22 * k;
              } },
    // Two quick light bounces
    bounce:  { dur: 1.0, cd: 5, run(t) {
                const k = Math.abs(Math.sin(t * Math.PI * 2));
                S.ty = -7 * k; S.tsy = 1 + .07 * k;
                S.twl = -26 * k; S.twr = 26 * k;
              } },
    // Tries to fly: fast flapping, gets a little airborne, floats, lands soft
    // Crouch → burst of real wingbeats → gets airborne → tires → soft landing.
    // Tries to fly: fast energetic wingbeats, gets high airborne (-80px!), floats, lands soft
    tryFly:  { dur: 2.45, cd: 0.2, run(t) {
                const flap = beat(t * Math.PI * 34);
                const takeoff = Math.min(1, t / .13);
                const landing = Math.max(0, (t - .84) / .16);
                const arc = Math.sin(Math.min(1, t / .88) * Math.PI);
                const airborne = arc * (1 - .18 * landing);
                const wingEnv = takeoff * (1 - landing);
                // Wing motion carries the action; the envelope avoids an
                // instant stop when Pip reaches the top of the arc.
                S.twl = (-62 - flap * 54) * wingEnv;
                S.twr = ( 62 + flap * 54) * wingEnv;
                S.ty = -74 * airborne + landing * 3;
                S.trot = Math.sin(t * Math.PI * 3.2) * 3.8 * airborne;
                // Subtle lift stretch and landing settle; no body shrink.
                S.tsy = 1 + .035 * airborne - .025 * landing;
                S.tsx = 1 - .018 * airborne + .035 * landing;
                S.teyeY = -.38 * airborne;
              } },
    // Idle arm stretch, one side then the other
    armSway: { dur: 2.4, cd: 9, run(t) {
                S.twl = -34 * Math.max(0, Math.sin(t * Math.PI * 2));
                S.twr =  34 * Math.max(0, -Math.sin(t * Math.PI * 2));
              } },
    celebrate:{dur: 2.2, cd: 0,  run(t) { const k = Math.abs(Math.sin(t * Math.PI * 3)); S.ty = -15 * k; S.tsy = 1 + .12 * k; const a = 30 * k; S.twl = -a; S.twr = a; } },
    droop:   { dur: 2.6, cd: 0,  run(t) { const k = Math.min(1, t * 3); S.ty = 4 * k; S.trot = -8 * k; S.tsy = 1 - .09 * k; S.tblink = 1 - .5 * k; S.teyeY = .9; } },
    sleep:   { dur: 999, cd: 0,  run(t) { S.tblink = .08; S.ty = 2 + Math.sin(t * .8) * 1.2; S.trot = -4; S.tsy = 1 + Math.sin(t * .8) * .03; } },
    startle: { dur: .8,  cd: 0,  run(t) { const k = Math.sin(t * Math.PI); S.ty = -10 * k; S.tsx = 1 + .12 * k; S.tblink = 1; S.twl = -30 * k; S.twr = 30 * k; } }
  };

  // Each behaviour has a voice. Kept quiet and organic so it never grates.
  const VOICE = {
    flap: 'flap', tryFly: 'flapRun', wave: 'chirp', armsUp: 'trill',
    hop: 'hop', hopSmall: 'hop', bounce: 'hop', celebrate: 'trill',
    giggle: 'giggle', shy: 'coo', droop: 'sad', sleep: 'sleep',
    startle: 'chirpTwice', peck: 'peck', yawn: 'coo', stretch: 'coo',
    waddle: 'peck', glance: null, tilt: null, preen: null, scratch: null,
    shiver: null, armSway: null, wiggle: 'chirp'
  };

  function doAction(name, opts = {}) {
    const a = ACTIONS[name];
    if (!a) return;
    S.action = name;
    S.actionStart = now();
    S.actionUntil = S.actionStart + (opts.dur || a.dur);
    COOLDOWN[name] = S.actionUntil + (a.cd || 0);
    if (opts.say) say(opts.say, opts.hold);

    // Give it a voice, rate-limited so overlapping behaviours never stack up
    const v = VOICE[name];
    if (v && opts.mute !== true && now() - (S.lastVoice || 0) > 0.16) {
      S.lastVoice = now();
      window.NexusAudio?.pet(v);
      // The flight attempt lands with a soft thud after the wingbeats
      if (name === 'tryFly') setTimeout(() => window.NexusAudio?.pet('land'), (a.dur - 0.18) * 1000);
      if (name === 'hop' || name === 'hopSmall') setTimeout(() => window.NexusAudio?.pet('land'), (a.dur * 0.72) * 1000);
    }
  }

  /* ─────────────── IDLE BEHAVIOUR SELECTION (utility scored) ─────────────── */
  function pickIdle() {
    const t = now();
    const cands = [
      ['glance',  1.6],
      ['tilt',    1.0 + S.boredom * .8],
      ['waddle',  0.8 + S.energy * .7],
      ['flap',    0.7 + S.energy * .9],
      ['hop',     0.5 + S.energy * 1.1],
      ['stretch', 0.5 + (1 - S.energy) * 1.2],
      ['preen',   0.7 + S.boredom * 1.0],
      ['scratch', 0.6 + S.boredom * .9],
      ['yawn',    0.3 + (1 - S.energy) * 1.8],
      ['peck',    0.6],
      ['shiver',  0.25],
      ['armSway', 0.9 + S.boredom * .7],
      ['hopSmall',0.5 + S.energy * .8],
      ['wave',    0.35 + S.affection * .9],
      ['tryFly',  0.3 + S.energy * 1.3]
    ].filter(([n]) => (COOLDOWN[n] || 0) < t);
    if (!cands.length) return;
    const total = cands.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [n, w] of cands) { if ((r -= w) <= 0) { doAction(n); return; } }
  }

  /* ─────────────── MAIN TICK ─────────────── */
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!pet) return;
    const t = now();
    const dt = Math.min(0.05, t - (S.lastT || t));
    S.lastT = t;

    /* drives */
    S.energy = Math.max(0, Math.min(1, S.energy + (S.asleep ? .02 : -.006) * dt));
    S.boredom = Math.min(1, S.boredom + dt * .012);
    S.patience = Math.min(1, S.patience + dt * .05);
    S.affection = Math.max(0, S.affection - dt * .004);

    /* fall asleep when ignored and low on energy */
    const idleFor = t - S.lastInteract;
    if (!S.asleep && idleFor > 55 && S.energy < .5 && S.mood === 'calm') {
      S.asleep = true; doAction('sleep', { say: 'sleepy', hold: 2600 });
    }

    /* reset per-frame targets unless an action owns them */
    S.trot = 0; S.tsx = 1; S.tsy = 1; S.ty = 0; S.twl = 0; S.twr = 0; S.tblink = 1;
    if (!S.asleep) { S.teyeX *= .86; S.teyeY *= .86; }

    /* gaze first, so a deliberate action can still override the eyes */
    if (!S.asleep) {
      if (S.gazeTarget) {
        S.teyeX = S.gazeTarget.x * GAZE_X;
        S.teyeY = S.gazeTarget.y * GAZE_Y;
      } else if (!S.action) {
        S.teyeX += Math.sin(ph0(t) * 0.29) * GAZE_X * .5;
        S.teyeY += Math.sin(ph0(t) * 0.37 + 1.7) * GAZE_Y * .5;
      }
    }

    /* run the active action */
    if (S.action) {
      const a = ACTIONS[S.action];
      const p = (t - S.actionStart) / (S.actionUntil - S.actionStart);
      if (p >= 1 && S.action !== 'sleep') { S.action = null; }
      else a.run(Math.min(1, Math.max(0, p)), t);
    } else if (t > S.nextIdle) {
      S.nextIdle = t + 2.4 + Math.random() * 6.5 * (1.3 - S.energy * .5);
      if (!S.asleep) pickIdle();
    }

    /* procedural breathing + sway — irrational ratios ⇒ never repeats */
    const ph = ph0(t);
    const breath = Math.sin(ph * 0.87) * .55 + Math.sin(ph * 1.371 + 1.1) * .3 + Math.sin(ph * 2.113 + 2.6) * .15;
    if (!S.asleep) {
      S.tsy += breath * .018;
      S.tsx += -breath * .010;
      S.trot += Math.sin(ph * 0.41) * 1.1 + Math.sin(ph * 0.73 + .8) * .6;
      // arms are never dead: a soft, asymmetric idle sway on both wings
      if (!S.action) {
        S.twl += Math.sin(ph * 0.63) * 5.5 + Math.sin(ph * 1.09 + .6) * 2.5 - 3;
        S.twr += -(Math.sin(ph * 0.58 + 1.4) * 5.5 + Math.sin(ph * 1.17) * 2.5) + 3;
      }
    } else {
      S.tsy += breath * .03;
      S.twl += Math.sin(ph * .5) * 1.5;
      S.twr += -Math.sin(ph * .5) * 1.5;
    }

    /* blinking — real animals blink in bursts, not on a metronome.
       Interval is exponentially distributed (Poisson process) and a blink is a
       fast close with a slower reopen, sometimes doubled. */
    if (!S.asleep) {
      if (t > S.nextBlink) {
        const mean = S.mood === 'attentive' ? 5.0 : S.energy < .4 ? 2.4 : 3.6;
        S.nextBlink = t + 0.9 - Math.log(1 - Math.random()) * mean;
        S.blinkAt = t;
        S.blinkN = Math.random() < .2 ? 2 : 1;      // occasional double blink
      }
      if (S.blinkAt != null) {
        const e = t - S.blinkAt;
        const cycle = 0.19;
        const i = Math.floor(e / cycle);
        if (i < S.blinkN) {
          const p = (e - i * cycle) / cycle;
          // close fast (35% of the cycle), reopen gently
          S.tblink = p < .35 ? 1 - (p / .35) * .94 : .06 + ((p - .35) / .65) * .94;
        } else S.blinkAt = null;
      }
      // a long stare while working looks intense: narrow the lids slightly
      if (S.mood === 'thinking' || S.mood === 'working') S.tblink = Math.min(S.tblink, .82);
      if (S.mood === 'sad') S.tblink = Math.min(S.tblink, .55);
    }

    /* micro-saccades — eyes never sit perfectly still */
    if (!S.asleep) {
      if (t > (S.nextSaccade || 0)) {
        S.nextSaccade = t + .35 + Math.random() * 1.5;
        S.saccade = { x: (Math.random() - .5) * GAZE_X * .5, y: (Math.random() - .5) * GAZE_Y * .5 };
      }
      if (S.saccade) { S.teyeX += S.saccade.x; S.teyeY += S.saccade.y; }
      // never let a pupil leave its socket
      S.teyeX = Math.max(-GAZE_X, Math.min(GAZE_X, S.teyeX));
      S.teyeY = Math.max(-GAZE_Y, Math.min(GAZE_Y, S.teyeY));
    }

    /* springs — critically-damped feel */
    const k = (cur, target, s) => cur + (target - cur) * Math.min(1, s * dt * 60);
    S.y    = k(S.y,    S.ty,    .18);
    S.rot  = k(S.rot,  S.trot,  .16);
    S.sx   = k(S.sx,   S.tsx,   .18);
    S.sy   = k(S.sy,   S.tsy,   .18);
    const wingSpeed = (S.action === 'tryFly' || S.action === 'flap') ? .85 : .24;
    S.wl   = k(S.wl,   S.twl,   wingSpeed);
    S.wr   = k(S.wr,   S.twr,   wingSpeed);
    S.eyeX = k(S.eyeX, S.teyeX, .14);
    S.eyeY = k(S.eyeY, S.teyeY, .14);
    S.blink= k(S.blink,S.tblink,.42);

    /* commit to CSS vars (SVG px == viewBox units) */
    const st = pet.style;
    st.setProperty('--py',   S.y.toFixed(2) + 'px');
    st.setProperty('--prot', S.rot.toFixed(2) + 'deg');
    st.setProperty('--psx',  S.sx.toFixed(3));
    st.setProperty('--psy',  S.sy.toFixed(3));
    st.setProperty('--eyex', S.eyeX.toFixed(2) + 'px');
    st.setProperty('--eyey', S.eyeY.toFixed(2) + 'px');
    // SVG rotate() is clockwise in a y-down space, so a wing hanging below its
    // shoulder opens OUTWARD with +θ on the left and −θ on the right. The action
    // library is authored as "negative = raised", so invert once here and every
    // action flaps outward instead of folding across the belly.
    st.setProperty('--wingl', (-S.wl).toFixed(2) + 'deg');
    st.setProperty('--wingr', (-S.wr).toFixed(2) + 'deg');
    st.setProperty('--blink', Math.max(.06, S.blink).toFixed(3));
    st.setProperty('--shx',  (1 - Math.min(.35, Math.abs(S.y) / 40)).toFixed(3));
    st.setProperty('--shop', (0.45 - Math.min(.3, Math.abs(S.y) / 45)).toFixed(3));
    pet.dataset.mood = S.mood;
    pet.dataset.asleep = S.asleep ? '1' : '0';
  }

  /* ─────────────── INTERACTION / REACTIONS ─────────────── */
  function wake(startle) {
    S.lastInteract = now();
    S.boredom = Math.max(0, S.boredom - .3);
    if (S.asleep) {
      S.asleep = false; S.action = null;
      doAction(startle ? 'startle' : 'glance', { say: 'wake', hold: 1600 });
    }
  }

  function setMood(m, dur = 3) {
    S.mood = m;
    clearTimeout(S.moodT);
    if (m !== 'calm') S.moodT = setTimeout(() => { S.mood = 'calm'; }, dur * 1000);
  }

  function sparkle(n = 10) {
    if (!host) return;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'pet-spark';
      s.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(1) + 'px');
      s.style.setProperty('--dy', (-20 - Math.random() * 30).toFixed(1) + 'px');
      s.style.setProperty('--d', (Math.random() * .25).toFixed(2) + 's');
      host.appendChild(s);
      setTimeout(() => s.remove(), 1200);
    }
  }

  // Public reaction hooks
  const REACT = {
    typing(len) {
      wake(true);
      setMood('attentive', 2.5);
      // lean toward the text and look down at the caret
      S.gazeTarget = { x: -.85, y: .85 };
      clearTimeout(S.gazeT);
      S.gazeT = setTimeout(() => { if (!S.hovering) S.gazeTarget = null; }, 1400);
      if (len > 0 && len % 28 === 0) doAction('peck');
      if (len > 90 && (COOLDOWN.wiggle || 0) < now()) doAction('wiggle', { say: 'excited', hold: 1500 });
      else if (Math.random() < .04) say('watching', 1300);
    },
    sent() {
      wake(true);
      setMood('alert', 3);
      S.gazeTarget = null;
      doAction('startle', { say: 'sent', hold: 1800 });
    },
    thinking(on) {
      if (!on) { if (S.mood === 'thinking') setMood('calm', 0); return; }
      wake(false);
      setMood('thinking', 60);
      if ((COOLDOWN.tilt || 0) < now()) doAction('tilt', { say: 'thinking', hold: 2000 });
    },
    working() {
      wake(false);
      setMood('working', 60);
      if ((COOLDOWN.waddle || 0) < now()) doAction('waddle', { say: 'working', hold: 1900 });
    },
    success() {
      wake(false);
      setMood('joy', 4);
      S.energy = Math.min(1, S.energy + .35);
      S.boredom = 0;
      doAction('celebrate');
      sparkle(14);
      // If the pipeline already posted "Your data is ready", leave it on screen.
      if (!S.reportUntil || now() >= S.reportUntil) say('joy', 2600);
    },
    failure() {
      wake(false);
      S.reportUntil = 0;
      setMood('sad', 4);
      doAction('droop', { say: 'sad', hold: 2600 });
    }
  };

  function bindInteraction() {
    // live gaze — Pip watches your cursor anywhere on screen
    document.addEventListener('mousemove', (e) => {
      if (!pet || S.asleep) return;
      const r = pet.getBoundingClientRect();
      if (!r.width) return;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist > 420) { if (!S.hovering) S.gazeTarget = null; return; }
      S.gazeTarget = {
        x: Math.max(-1, Math.min(1, (e.clientX - cx) / 150)),
        y: Math.max(-.6, Math.min(1, (e.clientY - cy) / 120))
      };
    }, { passive: true });

    // typing anywhere in a chat box
    document.addEventListener('input', (e) => {
      const ta = e.target.closest?.('.claude-input-container');
      if (!ta) return;
      REACT.typing((e.target.value || '').length);
    }, { passive: true });

    // sending
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('#chat-send-btn, .claude-send-btn')) REACT.sent();
    }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.closest?.('.claude-input-container')) REACT.sent();
    }, { passive: true });

    // AI busy → the live status card mounts/unmounts
    new MutationObserver(() => {
      if (!pet) return;
      REACT.thinking(!!document.getElementById('typing-indicator'));
    }).observe(document.body, { childList: true, subtree: true });

    // lead pipeline
    document.addEventListener('nexus:scrapeprogress', () => REACT.working());
    document.addEventListener('nexus:scrapedone', (e) => e.detail?.ok ? REACT.success() : REACT.failure());

    // LIVE NARRATION — Pip reports exactly what the agent is doing right now
    document.addEventListener('nexus:agentstatus', (e) => {
      const d = e.detail || {};
      if (!pet || !d.text) return;
      wake(false);
      if (d.finished) {
        // Final hand-off: hold the good news a little longer and celebrate.
        try { localStorage.setItem('skylark_has_run', 'true'); } catch (_) {}
        S.reportUntil = 0;
        report(d.text, d.step);
        S.reportUntil = now() + 6;
        setMood('joy', 5);
        doAction('celebrate');
        sparkle(14);
        return;
      }
      setMood('working', 90);
      report(d.text, d.step);
      // a small peck each time a lead actually lands, so progress feels physical
      if (d.lead && (COOLDOWN.peck || 0) < now()) doAction('peck');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (pet && !raf) { S.lastT = now(); raf = requestAnimationFrame(tick); }
    });
  }

  function bindPetElement() {
    let petting = 0, lastMove = 0;

    // Hover = quiet attention only. No pop, no scale, no forced animation —
    // it simply notices you: looks up at the cursor and holds still.
    pet.addEventListener('mouseenter', () => {
      S.hovering = true;
      S.lastInteract = now();
      S.boredom = Math.max(0, S.boredom - .15);
      if (S.asleep) { S.asleep = false; S.action = null; doAction('glance', { say: 'wake', hold: 1500 }); }
      setMood('curious', 3);
    });

    pet.addEventListener('mousemove', () => {
      const t = now();
      if (t - lastMove < .05) return;
      lastMove = t; petting++;
      if (petting > 14) {
        petting = 0;
        S.affection = Math.min(1, S.affection + .25);
        S.boredom = 0;
        setMood('loved', 3);
        // Being petted makes it react differently each time instead of always
        // launching into flight.
        const joy = ['wiggle', 'bounce', 'armsUp', 'tryFly']
          .filter(n => (COOLDOWN[n] || 0) < t);
        doAction(joy.length ? joy[(Math.random() * joy.length) | 0] : 'wiggle', { say: 'pet', hold: 1800 });
        sparkle(6);
      }
    });

    pet.addEventListener('mouseleave', () => {
      S.hovering = false; petting = 0;
      S.gazeTarget = null;
      if (S.mood === 'curious' || S.mood === 'loved') setMood('calm', 0);
    });

    pet.addEventListener('click', () => {
      const t = now();
      wake(true);
      if (t > S.clickWindow) { S.clicks = 0; S.clickWindow = t + 2.2; }
      S.clicks++;
      S.lastInteract = t;

      if (S.clicks >= 6) {                       // showered with taps → goes shy
        setMood('shy', 3);
        doAction('shy', { say: 'shy', hold: 2100 });
        setTimeout(() => { if (pet) { setMood('calm', 0); doAction('glance'); } }, 2400);
      } else if (S.clicks >= 3) {                // being tickled → giggles
        S.affection = Math.min(1, S.affection + .18);
        setMood('giggly', 2);
        doAction('giggle', { say: 'giggle', hold: 1500 });
        if (Math.random() < .5) sparkle(4);
      } else {
        // A touch is not a guaranteed flight trigger. Pip chooses a small,
        // believable reaction, with flight intentionally less common.
        S.affection = Math.min(1, S.affection + .15);
        S.energy = Math.min(1, S.energy + .25);
        setMood('happy', 3.5);
        const reaction = Math.random();
        if (reaction < .22) {
          COOLDOWN.tryFly = 0;
          COOLDOWN.flap = 0;
          doAction('tryFly', { say: 'fly', hold: 2600 });
          sparkle(10);
        } else if (reaction < .48) {
          doAction('hopSmall', { say: 'pet', hold: 1200 });
          sparkle(4);
        } else if (reaction < .74) {
          doAction('wiggle', { say: 'pet', hold: 1200 });
          sparkle(3);
        } else {
          doAction('glance', { say: 'pet', hold: 1000 });
        }
      }
    });

    pet.addEventListener('dblclick', (e) => e.preventDefault());
  }

  /* ─────────────── MOUNT / PLACE ─────────────── */
  function mount(container) {
    const parent = container?.parentElement;
    if (!container || !parent || parent.__petMounted) return;
    parent.__petMounted = true;
    anchor = container;

    host = document.createElement('div');
    host.className = 'nexus-pet-host';
    host.innerHTML = `
      <div class="nexus-pet" data-mood="calm" data-asleep="0" role="button" tabindex="0"
           aria-label="Pip, your Nexus companion" title="Pip — hover, pet or click me">
        <div class="pet-shadow"></div>
        ${buildSVG()}
      </div>`;
    container.insertAdjacentElement('beforebegin', host);

    pet = host.querySelector('.nexus-pet');

    // The bubble lives on <body> as a fixed layer. Kept inside the pet it was
    // clipped by the chat container's overflow whenever it grew wider than the
    // space to the pet's right. On body it can never be cropped or overlapped.
    document.querySelectorAll('.pet-bubble').forEach(n => n.remove());
    bubble = document.createElement('div');
    bubble.className = 'pet-bubble';
    document.body.appendChild(bubble);

    // A fixed layer must be re-anchored whenever the page geometry moves.
    if (!window.__petReflowBound) {
      window.__petReflowBound = true;
      const reflow = () => { if (bubble && bubble.classList.contains('show')) placeBubble(); };
      addEventListener('resize', reflow, { passive: true });
      addEventListener('scroll', reflow, { passive: true, capture: true });
      addEventListener('nexus:sidebarchange', reflow);
    }

    S.lastInteract = now();
    S.lastT = now();
    bindPetElement();
    if (!raf) raf = requestAnimationFrame(tick);
    setTimeout(() => { doAction('stretch', { say: 'greet', hold: 1800 }); }, 700);
  }

  function unmount() {
    cancelAnimationFrame(raf); raf = 0;
    document.querySelectorAll('.pet-bubble').forEach(n => n.remove());
    document.querySelectorAll('.nexus-pet-host').forEach(n => {
      if (n.parentElement) n.parentElement.__petMounted = false;
      n.remove();
    });
    host = pet = bubble = anchor = null;
  }

  function place() {
    if (!isEnabled() || matchMedia('(prefers-reduced-motion: reduce)').matches) { unmount(); return; }
    const boxes = [...document.querySelectorAll('.claude-input-container')].filter(b => b.offsetParent !== null);
    if (!boxes.length) return;
    if (pet && anchor === boxes[0] && host?.isConnected) return;
    unmount();
    mount(boxes[0]);
  }

  /* ═══════════════════════════════════════════════════════════════
     GUIDE BRAIN — Pip reads the app's real state, reasons about what
     matters most right now, and offers ONE actionable next step.

     Design: a utility-scored rule set (same idea as the idle behaviour
     picker). Each rule declares when it applies, how urgent it is, and
     optionally a one-click action. Highest score wins, with per-rule
     cooldowns and a global rate limit so it advises instead of nagging.
     ═══════════════════════════════════════════════════════════════ */
  const GUIDE = (() => {
    const seen = {};                 // rule id -> last shown (seconds)
    let lastTipAt = 0;
    let dismissedToday = 0;

    const num = (v) => Number.isFinite(+v) ? +v : 0;

    function context() {
      let leads = [];
      try { leads = JSON.parse(localStorage.getItem('allLeads') || '[]'); } catch (_) {}
      const view = (document.querySelector('.view.active')?.id || '').replace('view-', '');
      const cfgKeys = (window.SKYLARK_CONFIG?.APIFY_API_KEYS || []).filter(k => k && k.trim());
      const limit = num(window.SKYLARK_CONFIG?.APIFY_KEY_LIMIT) || 500;
      let used = 0;
      try {
        const idx = window.MemoryEngine?.getActiveApifyIdx?.() ?? 0;
        used = num(window.MemoryEngine?.getKeyUsage?.('apify', idx));
      } catch (_) {}
      const complete = leads.filter(l => l.website && l.email && l.phone).length;
      const contacted = leads.filter(l => l.status && String(l.status).toLowerCase() !== 'new').length;
      return {
        view, leads: leads.length, complete, contacted,
        hasKey: !!(cfgKeys.length || customKey),
        used, limit, usedPct: limit ? Math.round(used / limit * 100) : 0,
        hour: new Date().getHours(),
        everRun: localStorage.getItem('skylark_has_run') === 'true',
        idleFor: now() - S.lastInteract
      };
    }

    // ── Rules: highest score wins ──────────────────────────────────
    const RULES = [
      {
        id: 'no-key',
        cd: 300,
        score: c => c.hasKey ? 0 : 100,
        tip: () => 'No Apify key yet — add one in Settings and I can start hunting leads.',
        act: { label: 'Open Settings', run: () => window.openSettingsModal?.() }
      },
      {
        id: 'credits-low',
        cd: 600,
        score: c => (c.hasKey && c.usedPct >= 85) ? 90 : 0,
        tip: c => `Heads up — this Apify key is ${c.usedPct}% used. Add a spare before the next big run.`,
        act: { label: 'Open Settings', run: () => window.openSettingsModal?.() }
      },
      {
        id: 'first-run',
        cd: 240,
        score: c => (c.hasKey && c.leads === 0 && !c.everRun) ? 80 : 0,
        tip: () => 'Database is empty. Want me to pull 20 verified leads in Gurugram to start?',
        act: {
          label: 'Pull 20 leads',
          run: () => window.runScrapeFromChat?.({
            type: 'generate', cities: [window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram'],
            industries: ['ALL'], serviceType: ['Security', 'Housekeeping', 'Pantry Boy'], count: 20
          })
        }
      },
      {
        id: 'leads-empty-page',
        cd: 180,
        score: c => (c.view === 'leads' && c.leads === 0) ? 70 : 0,
        tip: () => 'Nothing here yet. Just tell me a city in chat and I\'ll fill this table.',
        act: { label: 'Go to chat', run: () => window.showView?.('chat') }
      },
      {
        id: 'export-ready',
        cd: 420,
        score: c => (c.complete >= 5 && c.view !== 'excel') ? 55 : 0,
        tip: c => `You have ${c.complete} fully verified leads ready to export.`,
        act: { label: 'Export', run: () => window.showView?.('excel') }
      },
      {
        id: 'start-outreach',
        cd: 480,
        score: c => (c.complete >= 3 && c.contacted === 0) ? 60 : 0,
        tip: () => 'These leads have never been contacted. Shall we start the email outreach?',
        act: { label: 'Open Email', run: () => window.showView?.('email') }
      },
      {
        id: 'follow-up',
        cd: 900,
        score: c => (c.contacted >= 3 && c.leads > c.contacted) ? 40 : 0,
        tip: c => `${c.leads - c.contacted} leads are still untouched — want to work through them?`,
        act: { label: 'Open Leads', run: () => window.showView?.('leads') }
      },
      {
        id: 'exact-count-tip',
        cd: 1200,
        score: c => (c.everRun && c.leads > 0) ? 22 : 0,
        tip: () => 'Tip: give me a number and I deliver exactly that — "15 leads in Noida for pantry boys".'
      },
      {
        id: 'tab-tip',
        cd: 1500,
        score: c => (c.view === 'chat') ? 18 : 0,
        tip: () => 'Tip: pause while typing and I\'ll suggest the rest — press Tab to accept it.'
      },
      {
        id: 'analytics-nudge',
        cd: 1200,
        // View-specific advice outranks generic nudges: guidance about the screen
        // you are actually looking at is more useful than a background reminder.
        score: c => (c.leads >= 15 && c.view === 'dashboard') ? 45 : 0,
        tip: () => 'Enough data to see patterns now — Analytics shows which cities convert best.',
        act: { label: 'Analytics', run: () => window.showView?.('analytics') }
      },
      {
        id: 'late-night',
        cd: 3600,
        score: c => (c.hour >= 23 || c.hour < 5) ? 15 : 0,
        tip: () => 'Late one. I can keep hunting leads while you rest — just give me a city.'
      }
    ];

    function pick() {
      const c = context();
      const t = now();
      let best = null, bestScore = 0;
      for (const r of RULES) {
        if (t - (seen[r.id] || -1e9) < r.cd) continue;
        const s = r.score(c);
        if (s > bestScore) { bestScore = s; best = r; }
      }
      return best ? { rule: best, ctx: c, score: bestScore } : null;
    }

    // Show a tip, preceded by a brief "thinking" beat so it feels considered
    function offer(force) {
      if (!pet || !bubble || S.asleep) return false;
      const t = now();
      if (!force) {
        if (t - lastTipAt < 45) return false;              // global rate limit
        if (S.reportUntil && t < S.reportUntil) return false;
        if (S.mood === 'working' || S.mood === 'thinking') return false;
        if (dismissedToday >= 6) return false;             // knows when to stop
      }
      const hit = pick();
      if (!hit) return false;
      lastTipAt = t;
      seen[hit.rule.id] = t;

      // thinking beat
      setMood('thinking', 1.2);
      doAction('tilt');
      bubble.classList.remove('pet-report', 'pet-tip');
      bubble.classList.add('show');
      bubble.textContent = '…';
      placeBubble();
      clearTimeout(bubble.__t);

      setTimeout(() => {
        if (!bubble || !pet) return;
        const text = typeof hit.rule.tip === 'function' ? hit.rule.tip(hit.ctx) : hit.rule.tip;
        S.reportUntil = now() + 14;
        bubble.classList.add('show', 'pet-tip');
        bubble.innerHTML = '';
        const p = document.createElement('span');
        p.className = 'pet-tip-text';
        p.textContent = text;
        bubble.appendChild(p);

        if (hit.rule.act) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'pet-tip-act';
          b.textContent = hit.rule.act.label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            close();
            S.affection = Math.min(1, S.affection + .2);
            setMood('happy', 2);
            doAction('armsUp');
            try { hit.rule.act.run(); } catch (_) {}
          });
          bubble.appendChild(b);
        }
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'pet-tip-close';
        x.setAttribute('aria-label', 'Dismiss');
        x.textContent = '×';
        x.addEventListener('click', (e) => { e.stopPropagation(); dismissedToday++; close(); });
        bubble.appendChild(x);

        setMood('curious', 3);
        placeBubble();
        bubble.__t = setTimeout(close, 13000);
      }, 620);
      return true;
    }

    function close() {
      if (!bubble) return;
      clearTimeout(bubble.__t);
      bubble.classList.remove('show', 'pet-tip');
      bubble.innerHTML = '';
      S.reportUntil = 0;
    }

    function start() {
      // Evaluate periodically; the rate limit and cooldowns keep it calm.
      setInterval(() => offer(false), 20000);
      setTimeout(() => offer(false), 9000);   // one early, useful hello
    }

    return { start, offer, close, context, rules: RULES.length };
  })();

  window.NexusPet = {
    isEnabled,
    setEnabled(on) { localStorage.setItem(KEY, String(!!on)); on ? place() : unmount(); },
    say,
    report,
    react: REACT,
    do: doAction,
    // Guide surface: ask for advice on demand, or inspect what it can see
    advise: () => GUIDE.offer(true),
    context: () => GUIDE.context(),
    get state() {
      return {
        mood: S.mood, energy: +S.energy.toFixed(2), boredom: +S.boredom.toFixed(2),
        affection: +S.affection.toFixed(2), asleep: S.asleep, guideRules: GUIDE.rules
      };
    }
  };

  function boot() {
    place();
    bindInteraction();
    GUIDE.start();
    new MutationObserver(() => place()).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => setTimeout(place, 120));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
