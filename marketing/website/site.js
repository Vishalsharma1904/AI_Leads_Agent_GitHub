/* Progressive enhancement only. All demo data is fictional and stays in this page. */
(() => {
  'use strict';
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.documentElement.classList.add('enhanced');

  const menus = all('.site-header details');
  const closeMenus = (restoreFocus = false) => menus.forEach(menu => {
    if (!menu.open) return;
    menu.open = false;
    if (restoreFocus) menu.querySelector('summary').focus();
  });
  document.addEventListener('click', event => {
    menus.forEach(menu => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenus(true);
  });
  menus.forEach(menu => menu.addEventListener('toggle', () => {
    if (menu.open) menus.forEach(other => { if (other !== menu) other.open = false; });
  }));
  const updateHeader = () => document.documentElement.classList.toggle('scrolled', window.scrollY > 15);
  window.addEventListener('scroll', updateHeader, { passive: true });
  updateHeader();

  // Tabs have immediate state changes; their new content animates without blocking input.
  all('[data-tabs]').forEach(group => {
    const tabs = all('[data-tab]', group);
    const panels = all('[data-panel]', group);
    const list = group.querySelector('[data-tablist]');
    if (!tabs.length || !panels.length || !list) return;
    list.setAttribute('role', 'tablist');
    const activate = (selected, focus = false) => {
      tabs.forEach(tab => {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach(panel => {
        const active = panel.dataset.panel === selected.dataset.tab;
        panel.hidden = !active;
        panel.classList.remove('is-entering');
        if (active && !motion.matches) {
          // Restart the CSS animation without timers or obsolete pending panel changes.
          panel.getAnimations().forEach(animation => animation.cancel());
          panel.classList.add('is-entering');
        }
      });
      const status = group.querySelector('[data-tab-status]');
      if (status) status.textContent = selected.dataset.status || selected.textContent.trim();
      if (focus) selected.focus();
    };
    tabs.forEach((tab, index) => {
      tab.setAttribute('role', 'tab');
      const panel = panels.find(item => item.dataset.panel === tab.dataset.tab);
      if (panel) {
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        panel.tabIndex = 0;
      }
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next !== undefined) { event.preventDefault(); activate(tabs[next], true); }
      });
    });
    activate(tabs.find(tab => tab.getAttribute('aria-selected') === 'true') || tabs[0]);
  });

  all('[data-lead-open]').forEach(button => button.addEventListener('click', () => {
    const group = button.closest('[data-lead-demo]');
    group.querySelector('[data-lead-detail]').textContent = button.dataset.leadOpen;
    all('[data-lead-open]', group).forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  const samples = {
    email: { meta: 'Email draft · Review before sending', copy: 'Subject: Housekeeping support for Oakfield Suites\n\nHello,\n\nWe provide housekeeping support for hospitality teams. I would like to understand whether Oakfield Suites is reviewing its staffing needs.\n\nWould a short conversation next week be useful?\n\nThank you,\nYour team' },
    whatsapp: { meta: 'WhatsApp draft · Review before sending', copy: 'Hello, this is your service team. We help hotels with housekeeping staffing. Is there a suitable person at Oakfield Suites we could speak with about your current needs?\n\nWe can share a short company introduction if it would be helpful.' },
    call: { meta: 'Call script · Preparation only', copy: 'Introduction\nHello, I am calling from your service team. Is this a convenient time for a short conversation?\n\nAsk\nAre you reviewing housekeeping or staffing support for your property?\n\nNext step\nIf there is a fit, ask permission to share a company introduction and agree on a follow-up time.' }
  };
  all('[data-channel]').forEach(button => button.addEventListener('click', () => {
    const group = button.closest('[data-draft-demo]');
    const selected = samples[button.dataset.channel];
    group.querySelector('[data-draft-meta]').textContent = selected.meta;
    group.querySelector('[data-draft-copy]').textContent = selected.copy;
    all('[data-channel]', group).forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  all('[data-crm-demo]').forEach(group => {
    const card = group.querySelector('[data-deal]');
    const columns = all('[data-stage]', group);
    const button = group.querySelector('[data-move-deal]');
    const status = group.querySelector('[data-crm-status]');
    let stage = 0;
    button.addEventListener('click', () => {
      stage = (stage + 1) % columns.length;
      columns[stage].append(card);
      columns.forEach((column, index) => column.querySelector('[data-count]').textContent = index === stage ? '1' : '0');
      card.querySelector('.tag').textContent = ['Ready to review', 'Contact attempted', 'Follow-up needed'][stage];
      button.textContent = ['Move to Contacted', 'Move to Follow-up', 'Reset sample'][stage];
      status.textContent = 'Sample moved to ' + columns[stage].dataset.stage + '.';
    });
  });
  all('[data-export-sample]').forEach(button => button.addEventListener('click', () => {
    const data = 'Company,Category,Area,Data type\r\nOakfield Suites,Hotel,Delhi,Fictional demo\r\nWillow Care Centre,Healthcare,Noida,Fictional demo\r\nCedar Business Park,Offices,Gurugram,Fictional demo\r\n';
    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'rudra24-fictional-sample.csv';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  all('[data-candidate-filter]').forEach(button => button.addEventListener('click', () => {
    const group = button.closest('[data-candidate-demo]');
    const role = button.dataset.candidateFilter;
    all('[data-candidate-role]', group).forEach(card => card.hidden = role !== 'all' && card.dataset.candidateRole !== role);
    all('[data-candidate-filter]', group).forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    group.querySelector('[data-candidate-status]').textContent = role === 'all' ? '3 fictional candidates shown.' : '1 fictional ' + role + ' candidate shown.';
  }));

  const form = document.querySelector('[data-contact-form]');
  if (form) {
    form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const name = String(values.get('name') || '').trim();
    const business = String(values.get('business') || '').trim();
    const interest = String(values.get('interest') || 'a product walkthrough');
    const message = String(values.get('message') || '').trim();
    const text = 'Hi, I would like to know more about Rudra24 AI.' + (name ? '\nMy name is ' + name + '.' : '') + (business ? '\nBusiness: ' + business : '') + '\nI am interested in ' + interest + '.' + (message ? '\n\n' + message : '');
    const draftLink = form.querySelector('[data-prepared-enquiry]');
    draftLink.href = 'https://wa.me/919999881949?text=' + encodeURIComponent(text);
    draftLink.hidden = false;
    form.querySelector('[data-enquiry-status]').textContent = 'Your enquiry is ready. Open WhatsApp, review it, then send when you are ready.';
    draftLink.focus();
    });
    // Disabled HTML defaults prevent native implicit submission without JS.
    form.querySelector('[data-contact-fields]').disabled = false;
  }

  // Media interactions are isolated in media.js.

  if ('IntersectionObserver' in window) {
    const reveals = all('.reveal');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.06, rootMargin: '0px 0px -18px 0px' });
    if (!motion.matches) document.documentElement.classList.add('motion-ready');
    reveals.forEach((element, index) => {
      if (index % 2) element.classList.add('from-right');
      element.style.setProperty('--reveal-delay', (element.matches('.feature-card,.step') ? index % 3 * 65 : 0) + 'ms');
      observer.observe(element);
    });
    motion.addEventListener('change', () => {
      document.documentElement.classList.toggle('motion-ready', !motion.matches);
      if (motion.matches) reveals.forEach(element => element.classList.add('visible'));
    });
  }
})();
