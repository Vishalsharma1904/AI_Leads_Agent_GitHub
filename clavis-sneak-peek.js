/**
 * CLAVIS SNEAK PEEK AGENT PIPELINE WINDOW (clavis-sneak-peek.js)
 * ==============================================================
 * Apple macOS & Claude inspired floating live task & agent pipeline
 * inspection popover.
 * 
 * - Solid floating card on right of orb, ZERO background page blur
 * - Minimalist typography with Cormorant Garamond task headers
 * - ChatGPT/Claude-style streaming text shimmer animation
 * - Autonomous named agent cards: Orchestrator, Web Intelligence,
 *   Synthesis & Scoring, Dispatch & Sync
 * - Fresh data lifecycle per task execution
 * ==============================================================
 */
'use strict';

(function ClavisSneakPeekModule() {

  var peekWindow = null;
  var overlay = null;
  var isOpen = false;
  var isPaused = false;
  var taskTimer = null;
  var elapsedSec = 0;

  // Active Task Data Model
  var activePipeline = {
    title: 'Autonomous Lead Intelligence & Scoring',
    status: 'running', // 'idle' | 'running' | 'done' | 'paused'
    activeStepIndex: 1, // 0 to 3
    steps: [
      { id: 'plan', label: 'Plan', done: true },
      { id: 'search', label: 'Scrape', done: false },
      { id: 'enrich', label: 'Enrich', done: false },
      { id: 'sync', label: 'Dispatch', done: false }
    ],
    agents: [
      {
        id: 'orchestrator',
        name: 'Orchestrator Agent',
        icon: '⚡',
        status: 'done',
        log: 'Decomposed objective into 3 concurrent intelligence work streams.',
        metric: '180ms latency'
      },
      {
        id: 'web_intel',
        name: 'Web Intelligence Agent',
        icon: '🌐',
        status: 'active',
        log: 'Scanning verified enterprise registries & active commercial hubs...',
        metric: '24 profiles found'
      },
      {
        id: 'synthesis',
        name: 'Synthesis & Scoring Agent',
        icon: '🧠',
        status: 'waiting',
        log: 'Awaiting raw records for multi-point ICP compliance verification.',
        metric: 'ICP Target >90%'
      },
      {
        id: 'dispatcher',
        name: 'Dispatch & Sync Agent',
        icon: '📬',
        status: 'waiting',
        log: 'Standing by to synchronize validated entries into Data Hub.',
        metric: 'Ready'
      }
    ]
  };

  /* ---------------------------------------------------------- *
   * Build DOM: Clean Solid Popover, NO background blur
   * ---------------------------------------------------------- */
  function build() {
    if (document.getElementById('clavis-sneak-peek-window')) return;

    // 1. Invisible click-dismiss backdrop (zero blur)
    overlay = document.createElement('div');
    overlay.className = 'clavis-sneak-peek-overlay';
    overlay.id = 'clavis-sneak-peek-overlay';
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);

    // 2. Floating Popover Window
    peekWindow = document.createElement('div');
    peekWindow.className = 'clavis-sneak-peek-window';
    peekWindow.id = 'clavis-sneak-peek-window';
    peekWindow.setAttribute('role', 'dialog');
    peekWindow.setAttribute('aria-label', 'Agent Pipeline & Live Task Peek');

    peekWindow.innerHTML = [
      '<!-- Header Bar -->',
      '<div class="csp-header-bar">',
      '  <div class="csp-status-badge">',
      '    <span class="csp-live-dot" id="csp-live-dot"></span>',
      '    <span id="csp-header-status">Live Agent Pipeline</span>',
      '  </div>',
      '  <div class="csp-header-actions">',
      '    <button type="button" class="csp-icon-btn" id="csp-pause-btn" onclick="ClavisSneakPeek.togglePause()" title="Pause/Resume Pipeline">',
      '      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
      '    </button>',
      '    <button type="button" class="csp-icon-btn" onclick="ClavisSneakPeek.close()" title="Close (Esc)">',
      '      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      '    </button>',
      '  </div>',
      '</div>',
      '',
      '<!-- Task Banner with Cormorant Garamond Heading -->',
      '<div class="csp-task-banner">',
      '  <div class="csp-task-eyebrow" id="csp-task-eyebrow">Active Execution</div>',
      '  <h3 class="csp-task-title" id="csp-task-title">Autonomous Lead Intelligence & <em>Scoring</em></h3>',
      '  <div class="csp-pipeline-track" id="csp-pipeline-track">',
      '    <!-- Pipeline steps rendered dynamically -->',
      '  </div>',
      '</div>',
      '',
      '<!-- Scrollable Body: Named Agent Logs -->',
      '<div class="csp-scroll-area" id="csp-agent-stream">',
      '  <!-- Agent cards rendered dynamically -->',
      '</div>',
      '',
      '<!-- Footer Bar -->',
      '<div class="csp-footer-bar">',
      '  <div class="csp-footer-status" id="csp-timer-display">',
      '    <span>⏱</span> <span id="csp-elapsed-time">0.0s</span> · <span id="csp-active-count">4 Agents Ready</span>',
      '  </div>',
      '  <button type="button" class="csp-footer-btn" onclick="ClavisSneakPeek.openDataHub()" title="Open in Leads Hub">',
      '    <span>View in Hub</span>',
      '    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
      '  </button>',
      '</div>'
    ].join('\n');

    document.body.appendChild(peekWindow);
    renderPipelineSteps();
    renderAgentCards();
    setupHotkeys();
    setupCommandInterceptors();
  }

  /* ---------------------------------------------------------- *
   * Render Pipeline Steps (4 Interconnected Nodes)
   * ---------------------------------------------------------- */
  function renderPipelineSteps() {
    var track = document.getElementById('csp-pipeline-track');
    if (!track) return;

    var html = [];
    activePipeline.steps.forEach(function(step, idx) {
      var isDone = step.done;
      var isActive = (idx === activePipeline.activeStepIndex && activePipeline.status === 'running');
      var cls = isDone ? 'csp-pipe-step done' : (isActive ? 'csp-pipe-step active' : 'csp-pipe-step');
      var nodeContent = isDone ? '✓' : (idx + 1);

      html.push(
        '<div class="' + cls + '">' +
        '  <div class="csp-step-node">' + nodeContent + '</div>' +
        '  <span class="csp-step-name">' + step.label + '</span>' +
        '</div>'
      );
    });

    track.innerHTML = html.join('');
  }

  /* ---------------------------------------------------------- *
   * Render Named Agent Cards with Streaming Shimmer
   * ---------------------------------------------------------- */
  function renderAgentCards() {
    var stream = document.getElementById('csp-agent-stream');
    if (!stream) return;

    var html = [];

    // If task is completed, render a celebratory completion card on top
    if (activePipeline.status === 'done') {
      html.push(
        '<div class="csp-completion-box">' +
        '  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' +
        '  <span>Pipeline Completed Successfully · All Leads Staged</span>' +
        '</div>'
      );
    }

    activePipeline.agents.forEach(function(ag) {
      var isActive = (ag.status === 'active');
      var isDone = (ag.status === 'done');
      var cardCls = 'csp-agent-card' + (isActive ? ' active-agent' : '') + (isDone ? ' done-agent' : '');
      var badgeText = isActive ? 'Active' : (isDone ? 'Complete' : 'Waiting');

      html.push(
        '<div class="' + cardCls + '" id="csp-agent-' + ag.id + '">' +
        '  <div class="csp-agent-top">' +
        '    <div class="csp-agent-meta">' +
        '      <span class="csp-agent-icon">' + ag.icon + '</span>' +
        '      <span class="csp-agent-name">' + ag.name + '</span>' +
        '    </div>' +
        '    <span class="csp-agent-badge">' + badgeText + '</span>' +
        '  </div>' +
        '  <p class="csp-agent-log">' + ag.log + '</p>' +
        '  <div class="csp-agent-metrics">' +
        '    <span class="csp-metric-chip">' + ag.metric + '</span>' +
        '  </div>' +
        '</div>'
      );
    });

    stream.innerHTML = html.join('');
  }

  /* ---------------------------------------------------------- *
   * Timer management
   * ---------------------------------------------------------- */
  function startTimer() {
    stopTimer();
    elapsedSec = 0;
    updateTimerDisplay();
    taskTimer = setInterval(function() {
      if (!isPaused) {
        elapsedSec += 0.5;
        updateTimerDisplay();
      }
    }, 500);
  }

  function stopTimer() {
    if (taskTimer) {
      clearInterval(taskTimer);
      taskTimer = null;
    }
  }

  function updateTimerDisplay() {
    var timerEl = document.getElementById('csp-elapsed-time');
    if (timerEl) {
      timerEl.textContent = elapsedSec.toFixed(1) + 's';
    }
  }

  /* ---------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------- */
  function open() {
    build();
    isOpen = true;
    peekWindow.classList.add('is-open');
    overlay.classList.add('is-active');

    var pulseDot = document.getElementById('csp-topbar-pulse-dot');
    if (pulseDot) pulseDot.style.display = 'inline-block';

    if (activePipeline.status === 'running' && !taskTimer) {
      startTimer();
    }
  }

  function close() {
    if (!peekWindow) return;
    isOpen = false;
    peekWindow.classList.remove('is-open');
    overlay.classList.remove('is-active');
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function togglePause() {
    isPaused = !isPaused;
    var pauseBtn = document.getElementById('csp-pause-btn');
    var statusEl = document.getElementById('csp-header-status');
    if (isPaused) {
      if (pauseBtn) pauseBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      if (statusEl) statusEl.textContent = 'Pipeline Paused';
    } else {
      if (pauseBtn) pauseBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      if (statusEl) statusEl.textContent = 'Live Agent Pipeline';
    }
  }

  /**
   * Start a brand-new task with fresh clean state
   */
  function start(taskName, customAgents) {
    build();
    activePipeline.title = taskName || 'Lead Intelligence & Campaign Pipeline';
    activePipeline.status = 'running';
    activePipeline.activeStepIndex = 1;
    isPaused = false;

    // Reset steps
    activePipeline.steps.forEach(function(s, idx) {
      s.done = (idx === 0);
    });

    if (Array.isArray(customAgents) && customAgents.length > 0) {
      activePipeline.agents = customAgents;
    } else {
      activePipeline.agents = [
        {
          id: 'orchestrator',
          name: 'Orchestrator Agent',
          icon: '⚡',
          status: 'done',
          log: 'Parsed task intent and constructed autonomous execution plan.',
          metric: '120ms latency'
        },
        {
          id: 'web_intel',
          name: 'Web Intelligence Agent',
          icon: '🌐',
          status: 'active',
          log: 'Extracting verified contact records & high-intent leads...',
          metric: 'Streaming live'
        },
        {
          id: 'synthesis',
          name: 'Synthesis & Scoring Agent',
          icon: '🧠',
          status: 'waiting',
          log: 'Prepared to evaluate ICP fit score and validate phone lines.',
          metric: 'Pending stream'
        },
        {
          id: 'dispatcher',
          name: 'Dispatch & Sync Agent',
          icon: '📬',
          status: 'waiting',
          log: 'Awaiting verified leads to update Lead Hub automatically.',
          metric: 'Ready'
        }
      ];
    }

    var titleEl = document.getElementById('csp-task-title');
    if (titleEl) {
      titleEl.innerHTML = formatEditorialTitle(activePipeline.title);
    }

    renderPipelineSteps();
    renderAgentCards();
    startTimer();
    open();
  }

  function formatEditorialTitle(str) {
    var words = str.split(' ');
    if (words.length > 2) {
      var last = words.pop();
      return words.join(' ') + ' <em>' + last + '</em>';
    }
    return str;
  }

  /**
   * Log an update for a named agent
   */
  function log(agentId, message, status, metric) {
    build();
    var found = false;
    activePipeline.agents.forEach(function(ag) {
      if (ag.id === agentId || ag.name.toLowerCase().includes(agentId.toLowerCase())) {
        ag.log = message;
        if (status) ag.status = status;
        if (metric) ag.metric = metric;
        found = true;
      }
    });

    renderAgentCards();
  }

  /**
   * Complete an agent & advance pipeline
   */
  function complete(agentId, successMsg) {
    build();
    activePipeline.agents.forEach(function(ag) {
      if (ag.id === agentId || ag.name.toLowerCase().includes(agentId.toLowerCase())) {
        ag.status = 'done';
        if (successMsg) ag.log = successMsg;
      }
    });

    // Advance step
    if (activePipeline.activeStepIndex < activePipeline.steps.length - 1) {
      activePipeline.steps[activePipeline.activeStepIndex].done = true;
      activePipeline.activeStepIndex++;
      // Activate next agent if available
      if (activePipeline.agents[activePipeline.activeStepIndex]) {
        activePipeline.agents[activePipeline.activeStepIndex].status = 'active';
      }
    }

    renderPipelineSteps();
    renderAgentCards();
  }

  /**
   * Finish the entire pipeline with success state
   */
  function finish(summary) {
    build();
    activePipeline.status = 'done';
    stopTimer();

    activePipeline.steps.forEach(function(s) { s.done = true; });
    activePipeline.agents.forEach(function(a) { a.status = 'done'; });

    var headerStatus = document.getElementById('csp-header-status');
    if (headerStatus) headerStatus.textContent = 'Task Completed';

    var dot = document.getElementById('csp-live-dot');
    if (dot) dot.style.animation = 'none';

    renderPipelineSteps();
    renderAgentCards();

    // Auto-dismiss smoothly after 4 seconds
    setTimeout(function() {
      if (activePipeline.status === 'done') {
        close();
      }
    }, 4000);
  }

  function clear() {
    activePipeline.status = 'idle';
    stopTimer();
    renderPipelineSteps();
    renderAgentCards();
  }

  function openDataHub() {
    if (typeof showView === 'function') {
      showView('hub');
    }
    close();
  }

  /* ---------------------------------------------------------- *
   * Keyboard shortcuts
   * ---------------------------------------------------------- */
  function setupHotkeys() {
    window.addEventListener('keydown', function(e) {
      // Escape closes
      if (e.key === 'Escape' && isOpen) {
        close();
        e.preventDefault();
      }
      // Ctrl/Cmd + Shift + P toggles
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        toggle();
        e.preventDefault();
      }
    });
  }

  /* ---------------------------------------------------------- *
   * Command Interceptor: Auto-trigger on automation tasks
   * ---------------------------------------------------------- */
  function setupCommandInterceptors() {
    // Intercept Run Agent button click
    var runBtn = document.getElementById('run-agent-btn');
    if (runBtn) {
      runBtn.addEventListener('click', function() {
        setTimeout(function() {
          start('Lead Intelligence & Autonomous Scrape Pipeline');
        }, 300);
      });
    }

    // Intercept Jarvis / chat inputs
    var mainInput = document.getElementById('chat-input') || document.getElementById('prompt-input');
    if (mainInput) {
      mainInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          var val = (mainInput.value || '').trim().toLowerCase();
          if (val.length > 5 && (val.includes('lead') || val.includes('search') || val.includes('find') || val.includes('automate') || val.includes('scrape') || val.includes('call') || val.includes('pipeline'))) {
            setTimeout(function() {
              start('Autonomous Intelligence: ' + val.slice(0, 32));
            }, 600);
          }
        }
      });
    }
  }

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  // Expose global API
  window.ClavisSneakPeek = {
    open: open,
    close: close,
    toggle: toggle,
    togglePause: togglePause,
    start: start,
    log: log,
    complete: complete,
    finish: finish,
    clear: clear,
    openDataHub: openDataHub
  };

  // Backwards-compatible alias
  window.ClavisPeek = window.ClavisSneakPeek;

})();
