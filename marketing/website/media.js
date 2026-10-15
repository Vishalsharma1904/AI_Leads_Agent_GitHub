/* Native playback; no live app requests. One decoder for all pointer previews. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const film = document.querySelector('#launch-film');
  if (film) {
    const toggle = document.querySelector('[data-film-toggle]');
    const expand = document.querySelector('[data-film-expand]');
    const status = document.querySelector('[data-film-status]');
    let pausedByUser = false, hovering = false, audioBlocked = false, failed = false, lastScroll = 0;
    const mute = () => { film.muted = true; };
    const label = () => { toggle.textContent = film.paused ? 'Play video' : 'Pause video'; };
    const fail = () => {
      failed = true;
      status.hidden = false;
      status.textContent = 'The film could not load. Open the video directly, or read the feature overview below.';
      document.querySelector('[data-film-fallback]').hidden = false;
      toggle.disabled = expand.disabled = true;
    };
    const quietPlay = () => {
      mute();
      if (failed || pausedByUser || document.hidden) return;
      film.play().catch(error => {
        if (error.name === 'NotSupportedError') fail();
        else if (error.name !== 'AbortError') label();
      });
    };
    const audiblePlay = () => {
      film.muted = false;
      film.play().catch(error => {
        if (error.name === 'NotSupportedError') { fail(); return; }
        audioBlocked = true;
        quietPlay();
      });
    };
    film.controls = false;
    film.muted = true;
    document.querySelector('#film-hint').textContent = fine.matches
      ? 'The workspace in action · Hover for sound'
      : 'The workspace in action · Tap the film for sound';
    if (reduced.matches) {
      film.autoplay = false; film.pause(); label();
      document.querySelector('#film-hint').textContent = 'The workspace in action · Play when you’re ready';
    }
    else quietPlay();
    film.addEventListener('pointerenter', () => {
      hovering = true;
      if (fine.matches && !audioBlocked && !film.paused && Date.now() - lastScroll > 350) audiblePlay();
    });
    film.addEventListener('pointerleave', () => { hovering = false; if (fine.matches) mute(); });
    document.addEventListener('scroll', () => { lastScroll = Date.now(); mute(); }, { passive: true, capture: true });
    document.addEventListener('click', event => { if (event.isTrusted) audioBlocked = false; });
    const gestureSound = () => {
      if (!film.muted) { mute(); return; }
      pausedByUser = false;
      audioBlocked = false;
      audiblePlay();
    };
    film.addEventListener('click', gestureSound);
    film.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); gestureSound(); }
    });
    // Move the same original-resolution player; never run two copies with audio.
    const dialog = document.querySelector('.film-dialog');
    const home = document.createComment('launch film position');
    film.before(home);
    expand.addEventListener('click', () => {
      mute(); dialog.showModal(); dialog.querySelector('[data-film-slot]').append(film);
      if (!pausedByUser && !reduced.matches) quietPlay();
      dialog.querySelector('[data-film-close]').focus();
    });
    document.querySelector('[data-film-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      mute(); home.after(film); if (!pausedByUser && !reduced.matches) quietPlay(); expand.focus();
    });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    toggle.addEventListener('click', () => {
      pausedByUser = !film.paused;
      if (pausedByUser) { mute(); film.pause(); }
      else quietPlay();
      label();
    });
    film.addEventListener('play', label);
    film.addEventListener('pause', () => {
      label();
      // Safari can pause an autoplaying film when hover attempts to unmute it.
      if (!film.muted && !pausedByUser && !document.hidden) {
        audioBlocked = true; quietPlay();
      }
    });
    film.addEventListener('error', fail);
    film.querySelector('source').addEventListener('error', fail);
    document.addEventListener('visibilitychange', () => {
      mute();
      if (document.hidden) film.pause();
      else if (!reduced.matches) quietPlay();
    });
    reduced.addEventListener('change', () => {
      mute();
      if (reduced.matches) film.pause(); else quietPlay();
    });
  }

  const cards = [...document.querySelectorAll('[data-feature-clip]')];
  if (!cards.length) return;
  const preview = document.createElement('div');
  preview.className = 'feature-hover';
  preview.setAttribute('aria-hidden', 'true');
  preview.innerHTML = '<video muted loop playsinline preload="none"></video><p></p>';
  document.body.append(preview);
  const video = preview.querySelector('video');
  let active = null, frame = 0, x = 0, y = 0, targetX = 0, targetY = 0, lastTime = 0;
  const hide = () => {
    active = null; preview.classList.remove('active'); video.pause();
    cancelAnimationFrame(frame); frame = 0; lastTime = 0;
  };
  const move = time => {
    const blend = 1 - Math.exp(-Math.min(time - (lastTime || time - 16), 40) / 85);
    lastTime = time;
    x += (targetX - x) * blend; y += (targetY - y) * blend;
    preview.style.setProperty('--preview-x', x + 'px');
    preview.style.setProperty('--preview-y', y + 'px');
    frame = active && Math.abs(targetX-x) + Math.abs(targetY-y) > .3 ? requestAnimationFrame(move) : 0;
    if (!frame) lastTime = 0;
  };
  const position = event => {
    const width = preview.offsetWidth, height = preview.offsetHeight;
    targetX = Math.max(16, Math.min(event.clientX + 22, innerWidth - width - 16));
    targetY = Math.max(16, Math.min(event.clientY - height - 22, innerHeight - height - 16));
    if (!frame) frame = requestAnimationFrame(move);
  };
  cards.forEach(card => {
    card.addEventListener('pointerenter', event => {
      if (!fine.matches || reduced.matches || card.closest('details')?.open) return;
      active = card;
      const key = card.dataset.featureClip;
      video.poster = 'assets/video/' + key + '-poster.jpg';
      video.src = 'assets/video/' + key + '.mp4';
      video.muted = true;
      preview.querySelector('p').textContent = card.querySelector('.card-category').textContent + ' · Inside the app';
      position(event); x = targetX; y = targetY;
      preview.classList.add('active');
      video.play().catch(() => {}); // Poster stays visible if autoplay is unavailable.
    });
    card.addEventListener('pointermove', event => { if (active === card) position(event); });
    card.addEventListener('pointerleave', hide);
    card.addEventListener('click', hide);
  });
  video.addEventListener('error', hide);
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  reduced.addEventListener('change', hide);
  fine.addEventListener('change', hide);
})();
