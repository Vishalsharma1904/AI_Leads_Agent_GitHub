/* Hover-scroll for the rail.
 * -------------------------------------------------------------
 * The scroll port is <nav id="sidebar-nav-scroll">, but the rail is
 * taller than it: the brand ("Rudra24 AI") sits above the nav and the
 * footer below it. The old version listened on the nav only, so moving
 * the pointer up to the brand left the nav's box -> pointerleave ->
 * stop. You could never reach the top by hovering, only by wheeling.
 * Now the edge zones are measured against the RAIL, so the brand is
 * "all the way up" and the last pixel of the rail is "all the way
 * down", and the velocity is critically damped instead of stepped.
 * Still no idle loop: the rAF only exists while something is moving.  */
(() => {
  const MAX_SPEED = 430;      // px/s at the very edge
  const ZONE_RATIO = 0.24;    // share of the rail height that reacts
  const ZONE_MIN = 64, ZONE_MAX = 150;
  const RAMP_MS = 130;        // how fast the speed reaches its target
  const WHEEL_HOLD = 650;     // hover yields to a real wheel for this long

  function install() {
    const nav = document.getElementById('sidebar-nav-scroll'), rail = document.getElementById('sidebar');
    if (!nav || !rail || nav.dataset.quietScroll) return;
    nav.dataset.quietScroll = '1';

    let speed = 0, wheelSpeed = 0, raf = 0, last = 0, inside = false, wheelUntil = 0;
    let position = 0, box = null, pointerY = 0, dirty = true, rangeMax = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const expanded = () => !rail.classList.contains('collapsed') || rail.classList.contains('au-peek');
    const motionOff = () => reduced.matches || document.documentElement.dataset.motion === 'off';

    function stop() {
      const moving = raf || last || speed || wheelSpeed;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; last = 0; speed = wheelSpeed = 0;
      if (moving) position = nav.scrollTop;   // never read layout while idle
    }

    /* -1 at the very top of the rail (over the brand) … +1 at the very
       bottom. Squared so the middle is calm and the edge is decisive. */
    function edgeAt(y, height) {
      const zone = Math.min(ZONE_MAX, Math.max(ZONE_MIN, height * ZONE_RATIO));
      let t = 0;
      if (y < zone) t = -(1 - Math.max(0, y) / zone);
      else if (y > height - zone) t = 1 - Math.max(0, height - y) / zone;
      return Math.sign(t) * Math.min(1, t * t);
    }

    function frame(now) {
      if (!expanded() || motionOff() || document.hidden ||
          ((!inside || now < wheelUntil) && Math.abs(wheelSpeed) < 1)) { stop(); return; }
      if (dirty || !box) {
        box = rail.getBoundingClientRect();
        rangeMax = Math.max(0, nav.scrollHeight - nav.clientHeight);
        dirty = false;
      }
      const dt = Math.min(32, now - (last || now - 16)); last = now;
      const wanted = inside && now >= wheelUntil ? edgeAt(pointerY - box.top, box.height) * MAX_SPEED : 0;
      speed += (wanted - speed) * (1 - Math.exp(-dt / RAMP_MS));
      const velocity = speed + wheelSpeed;
      position = Math.max(0, Math.min(rangeMax, position + velocity * dt / 1000));
      nav.scrollTop = position;
      wheelSpeed *= Math.exp(-13 * dt / 1000);
      if ((Math.abs(speed) < 1 && Math.abs(wanted) < 1 && Math.abs(wheelSpeed) < 1) ||
          (position <= 0 && velocity <= 0) || (position >= rangeMax && velocity >= 0)) { stop(); return; }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf) { position = nav.scrollTop; raf = requestAnimationFrame(frame); } }

    /* The whole rail is the hover surface — brand row included. */
    rail.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || !expanded()) return;
      if (e.target.closest('#sidebar-resizer')) return;
      inside = true;
      pointerY = e.clientY;
      if (performance.now() >= wheelUntil) start();
    }, { passive: true });
    rail.addEventListener('pointerenter', () => { dirty = true; }, { passive: true });
    /* A tooltip or any fixed overlay drawn under the cursor fires
       pointerleave even though the cursor never left the rail. Trust
       geometry, not the event. */
    rail.addEventListener('pointerleave', (e) => {
      const r = rail.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
      inside = false; stop();
    });
    rail.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') { inside = false; stop(); } }, { passive: true });

    /* A real wheel always wins; hover takes over again after it settles. */
    nav.addEventListener('wheel', () => { wheelUntil = performance.now() + WHEEL_HOLD; stop(); }, { passive: true });
    rail.addEventListener('wheel', e => {
      if (nav.contains(e.target) || !expanded() || nav.scrollHeight <= nav.clientHeight) return;
      e.preventDefault();                      // header/footer wheel still scrolls the nav
      wheelUntil = performance.now() + WHEEL_HOLD; speed = 0;
      if (motionOff()) { nav.scrollTop += e.deltaY; stop(); return; }
      wheelSpeed = Math.max(-1400, Math.min(1400, wheelSpeed + e.deltaY * 5.5));
      start();
    }, { passive: false });

    document.addEventListener('keydown', () => { inside = false; stop(); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { inside = false; stop(); } });
    window.addEventListener('blur', () => { inside = false; stop(); });
    window.addEventListener('resize', () => { dirty = true; }, { passive: true });
    rail.addEventListener('transitionend', () => { dirty = true; });
    nav.addEventListener('transitionend', () => { dirty = true; });
    new MutationObserver(() => { dirty = true; }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    new MutationObserver(() => { dirty = true; if (!expanded()) stop(); }).observe(rail, { attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(() => { dirty = true; }).observe(nav);
    /* The rail width is sprung, not transitioned, so the box has to be
       re-read while it is moving, not only on transitionend. */
    if (window.ResizeObserver) new ResizeObserver(() => { dirty = true; }).observe(rail);
    reduced.addEventListener?.('change', stop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
