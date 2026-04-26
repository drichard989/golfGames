(() => {
  'use strict';

  const CLOUD_SESSION_KEY = 'golf_cloud_session_v1';
  const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
  const REMOTE_APPLY_SUSPEND_MAX_MS = 5000;
  const BANKER_REMOTE_APPLY_GRACE_MS = 1200;
  const GAME_REMOTE_APPLY_GRACE_MS = 1200;
  const GAME_INTERACTION_SECTIONS = '#bankerSection, #wolfSection, #vegasSection, #skinsSection, #junkSection, #hiloSection';
  const GAME_TAB_INTERACTION_SELECTORS = '#entrySwitcherScoreBtn, #entrySwitcherGamesBtn, #toggleVegas, #toggleBanker, #toggleSkins, #toggleJunk, #toggleHilo, #toggleWolf';
  const PUSH_DEBOUNCE_MS = 900;
  const MIN_PUSH_INTERVAL_MS = 1200;
  const SNAPSHOT_LIST_LIMIT = 20;
  const VIEWER_LOCK_FEEDBACK_INTERVAL_MS = 1500;

  const EL = {
    createBtn: () => document.getElementById('cloudCreateBtn'),
    joinBtn: () => document.getElementById('cloudJoinBtn'),
    joinQrBtn: () => document.getElementById('cloudJoinQrBtn'),
    leaveBtn: () => document.getElementById('cloudLeaveBtn'),
    createBadgeBtn: () => document.getElementById('cloudCreateBadgeBtn'),
    qrBadgeBtn: () => document.getElementById('cloudQrBadgeBtn'),
    joinQrBadgeBtn: () => document.getElementById('cloudJoinQrBadgeBtn'),
    editCodeBadgeBtn: () => document.getElementById('cloudEditCodeBadgeBtn'),
    viewCodeBadgeBtn: () => document.getElementById('cloudViewCodeBadgeBtn'),
    joinCode: () => document.getElementById('cloudJoinCode'),
    snapshotSelect: () => document.getElementById('cloudSnapshotSelect'),
    loadSnapshotBtn: () => document.getElementById('cloudLoadSnapshotBtn'),
    resumeLiveBtn: () => document.getElementById('cloudResumeLiveBtn'),
    saveSnapshotBtn: () => document.getElementById('cloudSaveSnapshotBtn'),
    viewModeScorecardBanner: () => document.getElementById('viewModeScorecardBanner'),
    status: () => document.getElementById('cloudStatus'),
    codes: () => document.getElementById('cloudCodes'),
    snapshotStatus: () => document.getElementById('cloudSnapshotStatus')
  };

  const VIEWER_LOCK_SELECTORS = [
    '#courseSelect',
    '#addPlayerBtn',
    '#clearAllBtn',
    '#resetBtn',
    '#saveBtn',
    '#refreshAllBtn',
    '#advanceToggle',
    '#csvInput',
    'input[name="handicapMode"]',
    '#main-scorecard input',
    '#main-scorecard select',
    '#main-scorecard textarea',
    '#vegasSection input',
    '#vegasSection select',
    '#vegasSection textarea',
    '#vegasSection button',
    '#bankerSection input',
    '#bankerSection select',
    '#bankerSection textarea',
    '#bankerSection button',
    '#skinsSection input',
    '#skinsSection select',
    '#skinsSection textarea',
    '#skinsSection button',
    '#junkSection input',
    '#junkSection select',
    '#junkSection textarea',
    '#junkSection button',
    '#hiloSection input',
    '#hiloSection select',
    '#hiloSection textarea',
    '#hiloSection button',
    '#wolfSection input',
    '#wolfSection select',
    '#wolfSection textarea',
    '#wolfSection button'
  ];

  const VIEWER_ALLOWED_CLICK_IDS = new Set([
    'toggleVegas',
    'toggleBanker',
    'toggleSkins',
    'toggleJunk',
    'toggleHilo',
    'toggleWolf',
    'gamesLauncherBtn',
    'scorecardLauncherBtn',
    'vegasLiveResultsBtn',
    'bankerLiveResultsBtn',
    'junkLiveResultsBtn',
    'wolfLiveResultsBtn'
  ]);

  const VIEWER_BLOCK_CONTAINERS = '#main-scorecard, #vegasSection, #bankerSection, #skinsSection, #junkSection, #hiloSection, #wolfSection';

  const state = {
    initialized: false,
    app: null,
    appCheck: null,
    auth: null,
    db: null,
    functions: null,
    user: null,
    session: null, // { gameId, role, editCode?, viewCode? }
    unsubRef: null,
    snapshotListRef: null,
    isApplyingRemote: false,
    isViewingSnapshot: false,
    pushTimer: null,
    pendingRemoteState: null,
    pendingRemoteTimer: null,
    lastBankerInteractionAt: 0,
    lastGameInteractionAt: 0,
    lastSeenRevision: 0,
    lastSnapshotAt: 0,
    currentLiveState: null,
    activeSnapshotId: '',
    snapshots: [],
    originalSave: null,
    lastPushAt: 0,
    lastPushedContentHash: '',
    lockObserver: null,
    viewerLockApplied: false,
    viewerLockMutationTimer: null,
    lastViewerBlockedNoticeAt: 0,
    pushSuspended: false,
    remoteApplySuspendedUntil: 0,
    remoteApplyResumeTimer: null,
    needsPostJoinAlignment: false,
    joinProgressOverlayEl: null,
    joinProgressHideTimer: null
  };

  function clearRemoteApplyResumeTimer() {
    if (state.remoteApplyResumeTimer) {
      clearTimeout(state.remoteApplyResumeTimer);
      state.remoteApplyResumeTimer = null;
    }
  }

  function isRemoteApplySuspended() {
    return Date.now() < state.remoteApplySuspendedUntil;
  }

  function suspendRemoteApplies(durationMs = 700) {
    const requested = Number(durationMs);
    const clamped = Number.isFinite(requested)
      ? Math.max(0, Math.min(REMOTE_APPLY_SUSPEND_MAX_MS, requested))
      : 700;

    if (!clamped) return;

    state.remoteApplySuspendedUntil = Math.max(state.remoteApplySuspendedUntil, Date.now() + clamped);

    clearRemoteApplyResumeTimer();
    state.remoteApplyResumeTimer = setTimeout(() => {
      state.remoteApplyResumeTimer = null;
      flushPendingRemoteState();
    }, clamped + 24);
  }

  function resumeRemoteApplies() {
    state.remoteApplySuspendedUntil = 0;
    clearRemoteApplyResumeTimer();
    flushPendingRemoteState();
  }

  function clearJoinProgressOverlay() {
    if (state.joinProgressHideTimer) {
      clearTimeout(state.joinProgressHideTimer);
      state.joinProgressHideTimer = null;
    }
    if (state.joinProgressOverlayEl) {
      state.joinProgressOverlayEl.remove();
      state.joinProgressOverlayEl = null;
    }
  }

  function showJoinProgressOverlay(message = 'Connecting to live game...') {
    clearJoinProgressOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'cloudJoinProgressOverlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 10055',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'background: rgba(0, 0, 0, 0.58)',
      'opacity: 0',
      'transition: opacity 0.2s ease'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background: var(--panel)',
      'border: 1px solid var(--line)',
      'border-radius: 12px',
      'color: var(--ink)',
      'padding: 18px 20px',
      'width: min(92vw, 420px)',
      'text-align: center',
      'box-shadow: 0 14px 40px rgba(0, 0, 0, 0.38)'
    ].join(';');

    const spinner = document.createElement('div');
    spinner.className = 'cloud-join-progress-spinner';
    spinner.style.cssText = [
      'width: 34px',
      'height: 34px',
      'margin: 0 auto 12px auto',
      'border: 3px solid rgba(255, 255, 255, 0.2)',
      'border-top-color: var(--accent)',
      'border-radius: 50%',
      'animation: cloudJoinSpin 0.9s linear infinite'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Joining Live Game';
    title.style.cssText = 'font-size: var(--text-xl); font-weight: 700; margin-bottom: 6px;';

    const body = document.createElement('div');
    body.className = 'cloud-join-progress-text';
    body.textContent = message;
    body.style.cssText = 'font-size: var(--text-md); color: var(--muted); line-height: 1.4;';

    card.append(spinner, title, body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    state.joinProgressOverlayEl = overlay;

    // Inject keyframes once (inline style approach keeps this change self-contained).
    if (!document.getElementById('cloudJoinProgressStyle')) {
      const style = document.createElement('style');
      style.id = 'cloudJoinProgressStyle';
      style.textContent = '@keyframes cloudJoinSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });
  }

  function updateJoinProgressOverlay(message) {
    const overlay = state.joinProgressOverlayEl;
    if (!overlay) return;
    const textEl = overlay.querySelector('.cloud-join-progress-text');
    if (textEl) textEl.textContent = message;
  }

  function completeJoinProgressOverlay(role) {
    const overlay = state.joinProgressOverlayEl;
    if (!overlay) return;

    const spinner = overlay.querySelector('.cloud-join-progress-spinner');
    const textEl = overlay.querySelector('.cloud-join-progress-text');
    const mode = role === 'editor' ? 'EDIT' : 'VIEW';

    if (spinner) {
      spinner.style.animation = 'none';
      spinner.style.border = '3px solid rgba(0, 188, 140, 0.55)';
      spinner.style.borderTopColor = 'rgba(0, 188, 140, 0.55)';
      spinner.textContent = 'OK';
      spinner.style.display = 'flex';
      spinner.style.alignItems = 'center';
      spinner.style.justifyContent = 'center';
      spinner.style.fontWeight = '700';
      spinner.style.fontSize = '11px';
      spinner.style.color = 'var(--accent)';
    }

    if (textEl) {
      textEl.textContent = `Joined as ${mode} mode`;
      textEl.style.color = 'var(--ink)';
      textEl.style.fontWeight = '600';
    }

    if (typeof window.announce === 'function') {
      window.announce(`Joined as ${mode} mode`);
    }

    state.joinProgressHideTimer = setTimeout(() => {
      if (!state.joinProgressOverlayEl) return;
      state.joinProgressOverlayEl.style.opacity = '0';
      state.joinProgressHideTimer = setTimeout(() => {
        clearJoinProgressOverlay();
      }, 220);
    }, 1100);
  }

  function setStatus(msg) {
    const statusEl = EL.status();
    if (!statusEl) return;

    statusEl.textContent = msg;

    // Single source of truth for header status/toggle: active session presence.
    // This avoids status-badge drift from heuristic text parsing.
    const isLive = !!state.session;
    statusEl.setAttribute('data-live', isLive ? 'true' : 'false');

    const badge = document.getElementById('cloudStatusBadge');
    if (badge) {
      if (isLive) {
        const mode = state.session?.role === 'editor' ? 'Edit' : 'View';
        badge.textContent = `☁ Live (${mode})`;
        badge.setAttribute('data-live', 'true');
      } else {
        badge.textContent = '☁ Offline';
        badge.setAttribute('data-live', 'false');
      }
    }

    syncHeaderCodeBadgeButtons();
  }

  function syncHeaderCodeBadgeButtons() {
    const createBtn = EL.createBadgeBtn();
    const qrBtn = EL.qrBadgeBtn();
    const joinQrBtn = EL.joinQrBadgeBtn();
    const editBtn = EL.editCodeBadgeBtn();
    const viewBtn = EL.viewCodeBadgeBtn();

    if (createBtn) {
      const isLive = EL.status()?.getAttribute('data-live') === 'true';
      createBtn.hidden = false;
      createBtn.disabled = false;
      createBtn.textContent = isLive ? 'Go offline' : 'Go live';
      createBtn.title = isLive ? 'Leave live session' : 'Create live session';
      createBtn.setAttribute('data-live', isLive ? 'true' : 'false');
    }

    if (qrBtn) {
      qrBtn.disabled = false;
      qrBtn.textContent = 'Share QR';
      qrBtn.title = 'Share live view QR code';
    }

    if (joinQrBtn) {
      joinQrBtn.disabled = false;
      joinQrBtn.textContent = 'Join QR';
      joinQrBtn.title = 'Scan a QR code to join a live game';
    }

    if (editBtn) {
      const editCode = normalizeCode(state.session?.editCode || '');
      const headerExpanded = !document.querySelector('header')?.classList.contains('header-collapsed');
      const show = !!editCode && headerExpanded;
      editBtn.hidden = !show;
      if (show) {
        editBtn.disabled = false;
        const textSpan = editBtn.querySelector('.badge-text');
        if (textSpan) {
          textSpan.textContent = `Edit ${editCode}`;
        } else {
          editBtn.textContent = `Edit ${editCode}`;
        }
        editBtn.title = 'Tap to share edit link';
      }
    }

    if (viewBtn) {
      const viewCode = normalizeCode(state.session?.viewCode || '');
      const headerExpanded = !document.querySelector('header')?.classList.contains('header-collapsed');
      const show = !!viewCode && headerExpanded;
      viewBtn.hidden = !show;
      if (show) {
        viewBtn.disabled = false;
        const textSpan = viewBtn.querySelector('.badge-text');
        if (textSpan) {
          textSpan.textContent = `View ${viewCode}`;
        } else {
          viewBtn.textContent = `View ${viewCode}`;
        }
        viewBtn.title = 'Tap to share view-only link';
      }
    }
  }

  async function shareSessionLink(codeType) {
    const hasEditCode = !!normalizeCode(state.session?.editCode || '');
    if (codeType === 'edit' && !hasEditCode) {
      const warning = "Cloud: You don't have Scorekeeping Access. Sharing view-only code instead.";
      setStatus(warning);
      if (typeof window.announce === 'function') {
        window.announce("No Scorekeeping Access. Sharing view-only code.");
      }
      codeType = 'view';
    }

    const key = codeType === 'edit' ? 'editCode' : 'viewCode';
    const label = codeType === 'edit' ? 'Edit' : 'View';
    const code = normalizeCode(state.session?.[key] || '');
    if (!code) {
      throw new Error(`${label} code unavailable`);
    }

    const link = codeType === 'edit'
      ? buildEditShareUrl(code)
      : buildViewShareUrl(code);

    if (navigator.share) {
      await navigator.share({
        title: `Manito Golf Games ${label} Link`,
        text: `${label} access link`,
        url: link
      });
    } else {
      window.prompt(`Share ${label.toLowerCase()} link`, link);
    }

    setStatus(`Cloud: ${label.toLowerCase()} link shared`);
    if (typeof window.announce === 'function') {
      window.announce(`${label} link shared.`);
    }
  }

  async function chooseQrShareMode() {
    const canShareScorekeepingQr = !!normalizeCode(state.session?.editCode || '') || state.session?.role === 'editor' || !state.session;

    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10050;padding:16px;animation:fadeIn 0.2s ease;';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      const box = document.createElement('div');
      box.style.cssText = 'background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;max-width:420px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,0.3);animation:slideUpFull 0.16s cubic-bezier(0.2,0.8,0.2,1);';

      const title = document.createElement('h3');
      title.textContent = 'Share QR Type';
      title.style.cssText = 'margin:0 0 10px 0;color:var(--ink);font-size:18px;';

      const msg = document.createElement('p');
      msg.textContent = 'Choose whether this QR opens view-only or edit access.';
      msg.style.cssText = 'margin:0 0 14px 0;color:var(--muted);font-size:14px;line-height:1.4;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn';
      viewBtn.textContent = 'View-only QR';
      viewBtn.style.cssText = 'flex:1 1 120px;';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn';
      editBtn.textContent = 'Scorekeeping QR';
      editBtn.style.cssText = 'flex:1 1 120px;';
      editBtn.disabled = !canShareScorekeepingQr;
      if (!canShareScorekeepingQr) {
        editBtn.title = 'Scorekeeping QR is only available for editor sessions';
      }

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'flex:1 1 120px;';

      const close = (choice) => {
        box.style.animation = 'slideDownFull 0.18s cubic-bezier(0.4,0,1,1) forwards';
        dialog.style.animation = 'fadeOut 0.18s ease forwards';
        setTimeout(() => {
          dialog.remove();
          resolve(choice);
        }, 185);
      };

      viewBtn.addEventListener('click', () => close('view'));
      editBtn.addEventListener('click', () => close('edit'));
      cancelBtn.addEventListener('click', () => close(null));
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) close(null);
      });

      row.append(viewBtn, editBtn, cancelBtn);
      box.append(title, msg, row);
      dialog.appendChild(box);
      document.body.appendChild(dialog);
    });
  }

  function showJoinSuccessToast(role) {
    const mode = role === 'editor' ? 'EDIT' : 'VIEW';
    const message = `Joined as ${mode}`;

    const existing = document.getElementById('cloudJoinSuccessOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cloudJoinSuccessOverlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 10050;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.42);
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--ink);
      padding: 16px 20px;
      font-size: var(--text-xl);
      font-weight: 700;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.38);
      max-width: min(90vw, 420px);
      text-align: center;
    `;
    card.textContent = message;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });

    const displayMs = 3600;
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 220);
    }, displayMs);

    if (typeof window.announce === 'function') {
      window.announce(message);
    }
  }

  function setCodesText(text, visible = false) {
    const el = EL.codes();
    if (!el) return;
    el.textContent = text;
    el.style.display = visible ? '' : 'none';
  }

  function setSnapshotStatus(text, visible = false) {
    const el = EL.snapshotStatus();
    if (!el) return;
    el.textContent = text;
    el.style.display = visible ? '' : 'none';
  }

  function setViewModeBannersVisible(visible) {
    const scorecardBanner = EL.viewModeScorecardBanner();
    if (scorecardBanner) {
      scorecardBanner.style.display = visible ? '' : 'none';
    }
  }

  function setViewerLockEnabled(enabled) {
    const nodes = Array.from(document.querySelectorAll(VIEWER_LOCK_SELECTORS.join(',')));
    nodes.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;

      // Never disable buttons that viewers are explicitly allowed to click
      if (el instanceof HTMLButtonElement && el.id && VIEWER_ALLOWED_CLICK_IDS.has(el.id)) return;

      if (enabled) {
        if (el.dataset.cloudPrevDisabled === undefined) {
          el.dataset.cloudPrevDisabled = el.disabled ? '1' : '0';
        }
        if ('readOnly' in el && el.dataset.cloudPrevReadonly === undefined) {
          el.dataset.cloudPrevReadonly = el.readOnly ? '1' : '0';
        }

        if ('readOnly' in el) {
          el.readOnly = true;
        }
        el.disabled = true;
        el.setAttribute('aria-disabled', 'true');
        el.classList.add('cloud-view-locked');
        return;
      }

      if (el.dataset.cloudPrevDisabled !== undefined) {
        el.disabled = el.dataset.cloudPrevDisabled === '1';
        delete el.dataset.cloudPrevDisabled;
      } else {
        el.disabled = false;
      }

      if ('readOnly' in el && el.dataset.cloudPrevReadonly !== undefined) {
        el.readOnly = el.dataset.cloudPrevReadonly === '1';
        delete el.dataset.cloudPrevReadonly;
      } else if ('readOnly' in el) {
        el.readOnly = false;
      }

      el.removeAttribute('aria-disabled');
      el.classList.remove('cloud-view-locked');
    });
  }

  function clearViewerLockMutationTimer() {
    if (state.viewerLockMutationTimer) {
      clearTimeout(state.viewerLockMutationTimer);
      state.viewerLockMutationTimer = null;
    }
  }

  function isViewerSession() {
    return state.session?.role === 'viewer';
  }

  function notifyViewerReadOnly() {
    const now = Date.now();
    if (now - state.lastViewerBlockedNoticeAt < VIEWER_LOCK_FEEDBACK_INTERVAL_MS) {
      return;
    }

    state.lastViewerBlockedNoticeAt = now;
    const msg = 'View mode is read-only';
    if (typeof window.announce === 'function') {
      window.announce(msg);
    }
  }

  function shouldBlockViewerEvent(target, eventType) {
    if (!(target instanceof HTMLElement)) return false;
    if (!isViewerSession()) return false;

    if (eventType === 'click' || eventType === 'pointerdown' || eventType === 'mousedown' || eventType === 'touchstart') {
      const allowedBtn = target.closest('button[id], [role="button"][id]');
      if (allowedBtn instanceof HTMLElement && VIEWER_ALLOWED_CLICK_IDS.has(allowedBtn.id)) {
        return false;
      }
    }

    if (target.closest(VIEWER_BLOCK_CONTAINERS)) {
      return true;
    }

    return !!target.closest(VIEWER_LOCK_SELECTORS.join(','));
  }

  function enforceViewerReadOnlyGuards() {
    const guard = (event) => {
      if (!event?.isTrusted) return;
      const target = event.target;
      const eventType = event.type;
      if (!shouldBlockViewerEvent(target, eventType)) return;

      event.preventDefault();
      event.stopPropagation();
      syncViewerLock({ force: true, syncRows: false });
      setStatus('Cloud: connected (viewer) • Read-only mode');
      notifyViewerReadOnly();
    };

    document.addEventListener('beforeinput', guard, true);
    document.addEventListener('input', guard, true);
    document.addEventListener('change', guard, true);
    document.addEventListener('pointerdown', guard, true);
    document.addEventListener('mousedown', guard, true);
    document.addEventListener('touchstart', guard, true);
    document.addEventListener('click', guard, true);
    document.addEventListener('keydown', guard, true);
  }

  function ensureViewerLockObserver() {
    if (state.lockObserver || typeof MutationObserver === 'undefined') return;
    if (!document.body) return;

    state.lockObserver = new MutationObserver(() => {
      if (!isViewerSession()) return;
      clearViewerLockMutationTimer();
      state.viewerLockMutationTimer = setTimeout(() => {
        state.viewerLockMutationTimer = null;
        syncViewerLock({ force: true, syncRows: false });
      }, 80);
    });

    state.lockObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function syncViewerLock(options = {}) {
    const { force = false, syncRows = false } = options || {};
    const shouldLock = state.session?.role === 'viewer';

    if (!force && shouldLock === state.viewerLockApplied) {
      return;
    }

    setViewerLockEnabled(shouldLock);
    setViewModeBannersVisible(shouldLock);
    state.viewerLockApplied = shouldLock;

    if (syncRows) {
      const sync = window.GolfApp?.scorecard?.build?.syncRowHeights;
      if (typeof sync === 'function') {
        requestAnimationFrame(() => sync(true));
      }
    }
  }

  function formatSnapshotLabel(snapshot) {
    const createdAt = Number(snapshot?.createdAt) || 0;
    const dateText = createdAt
      ? new Date(createdAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        })
      : 'Unknown time';
    const revision = Number(snapshot?.revision) || Number(snapshot?.state?.meta?.revision) || 0;
    const source = snapshot?.source === 'manual-restore' ? 'restored' : snapshot?.source === 'manual-save' ? 'manual' : 'auto';
    return revision ? `${dateText} • rev ${revision} • ${source}` : `${dateText} • ${source}`;
  }

  function getSnapshotById(snapshotId) {
    return state.snapshots.find((snapshot) => snapshot.id === snapshotId) || null;
  }

  function renderSnapshotOptions() {
    const selectEl = EL.snapshotSelect();
    if (!selectEl) return;

    const currentValue = state.activeSnapshotId || '';
    selectEl.innerHTML = '';

    const liveOption = document.createElement('option');
    liveOption.value = '';
    liveOption.textContent = 'Live current version';
    selectEl.appendChild(liveOption);

    state.snapshots.forEach((snapshot) => {
      const option = document.createElement('option');
      option.value = snapshot.id;
      option.textContent = formatSnapshotLabel(snapshot);
      selectEl.appendChild(option);
    });

    if (currentValue && getSnapshotById(currentValue)) {
      selectEl.value = currentValue;
    } else {
      selectEl.value = '';
      if (!state.isViewingSnapshot) {
        state.activeSnapshotId = '';
      }
    }
  }

  function syncSnapshotButtons() {
    const canUseSnapshots = !!state.session;
    const canReview = canUseSnapshots && !!EL.snapshotSelect()?.value;
    const isEditor = state.session?.role === 'editor';

    const selectEl = EL.snapshotSelect();
    if (selectEl) selectEl.disabled = !canUseSnapshots;

    const loadBtn = EL.loadSnapshotBtn();
    if (loadBtn) loadBtn.disabled = !canReview;

    const resumeBtn = EL.resumeLiveBtn();
    if (resumeBtn) resumeBtn.disabled = !canUseSnapshots || !state.isViewingSnapshot;

    const saveBtn = EL.saveSnapshotBtn();
    if (saveBtn) saveBtn.disabled = !canUseSnapshots || !state.isViewingSnapshot || !isEditor;
  }

  function resetSnapshotReviewUi() {
    state.isViewingSnapshot = false;
    state.activeSnapshotId = '';
    renderSnapshotOptions();
    setSnapshotStatus('', false);
    syncSnapshotButtons();
  }

  function normalizeCode(code) {
    return String(code || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function getCodeFromUrl() {
    try {
      const url = new URL(window.location.href);
      const direct = url.searchParams.get('view') || url.searchParams.get('code') || '';
      return normalizeCode(direct);
    } catch {
      return '';
    }
  }

  function clearCodeFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('view') && !url.searchParams.has('code')) return;
      url.searchParams.delete('view');
      url.searchParams.delete('code');
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', next);
    } catch {}
  }

  function buildViewShareUrl(viewCode) {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.set('view', normalizeCode(viewCode));
    return url.toString();
  }

  function buildEditShareUrl(editCode) {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.set('code', normalizeCode(editCode));
    return url.toString();
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${parts.join(',')}}`;
  }

  function getComparableSyncPayload(syncGame) {
    const game = syncGame || {};
    return {
      scorecard: game.scorecard || {},
      games: game.games || {}
    };
  }

  function getSyncContentHash(syncGame) {
    try {
      return stableStringify(getComparableSyncPayload(syncGame));
    } catch {
      return '';
    }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function buildDiffUpdates(prevValue, nextValue, basePath, updates) {
    if (prevValue === nextValue) return;

    const prevIsArray = Array.isArray(prevValue);
    const nextIsArray = Array.isArray(nextValue);
    const prevIsObject = isPlainObject(prevValue);
    const nextIsObject = isPlainObject(nextValue);

    // Primitive or type-changed values: replace at this path.
    if ((!prevIsArray && !prevIsObject && !nextIsArray && !nextIsObject) ||
        (prevIsArray !== nextIsArray) ||
        (prevIsObject !== nextIsObject)) {
      if (!basePath) {
        // Root replacement handled by caller with set().
        return;
      }
      updates[basePath] = nextValue;
      return;
    }

    if (nextIsArray) {
      const prevArr = prevIsArray ? prevValue : [];
      const nextArr = nextValue;
      const maxLen = Math.max(prevArr.length, nextArr.length);

      for (let i = 0; i < maxLen; i += 1) {
        const childPath = basePath ? `${basePath}/${i}` : `${i}`;
        if (i >= nextArr.length) {
          updates[childPath] = null;
          continue;
        }
        if (i >= prevArr.length) {
          updates[childPath] = nextArr[i];
          continue;
        }
        buildDiffUpdates(prevArr[i], nextArr[i], childPath, updates);
      }
      return;
    }

    const prevObj = prevIsObject ? prevValue : {};
    const nextObj = nextValue;
    const keySet = new Set([...Object.keys(prevObj), ...Object.keys(nextObj)]);

    keySet.forEach((key) => {
      const childPath = basePath ? `${basePath}/${key}` : key;
      if (!(key in nextObj)) {
        updates[childPath] = null;
        return;
      }
      if (!(key in prevObj)) {
        updates[childPath] = nextObj[key];
        return;
      }
      buildDiffUpdates(prevObj[key], nextObj[key], childPath, updates);
    });
  }

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(CLOUD_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function storeSession(session) {
    try {
      if (!session) {
        localStorage.removeItem(CLOUD_SESSION_KEY);
      } else {
        localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(session));
      }
    } catch {}
  }

  function hasFirebaseConfig() {
    const cfg = window.FIREBASE_CONFIG;
    return !!(cfg && cfg.apiKey && cfg.projectId && cfg.databaseURL);
  }

  function buildCreatePayload() {
    const syncState = window.GolfApp?.storage?.getSyncGameState?.();
    return {
      game: syncState || null,
      requestedAt: Date.now()
    };
  }

  function getFunctions() {
    if (!state.functions) return null;
    return state.functions;
  }

  async function ensureAppCheckToken() {
    if (!state.appCheck || typeof state.appCheck.getToken !== 'function') return;
    try {
      await state.appCheck.getToken(false);
    } catch (err) {
      const msg = String(err?.message || err || '').toLowerCase();
      if (msg.includes('app-check') || msg.includes('appcheck') || msg.includes('attestation')) {
        throw new Error('App Check token unavailable. Refresh and try again.');
      }
      throw err;
    }
  }

  async function callFunction(name, data) {
    const fns = getFunctions();
    if (!fns) throw new Error('Cloud Functions unavailable');
    await ensureAppCheckToken();
    const callable = fns.httpsCallable(name);
    const result = await callable(data || {});
    return result?.data;
  }

  async function ensureShareSessionCodes() {
    if (!state.session) {
      await createSession();
    }

    if (!state.session || state.session.role !== 'editor') {
      throw new Error('Editor access is required to share a live scorecard.');
    }

    if (state.session.viewCode && state.session.editCode) {
      return {
        viewCode: state.session.viewCode,
        editCode: state.session.editCode
      };
    }

    const codes = await callFunction('getGameCodes', {
      gameId: state.session.gameId
    });

    const viewCode = normalizeCode(codes?.viewCode);
    const editCode = normalizeCode(codes?.editCode || state.session.editCode || '');
    if (!viewCode || !editCode) {
      throw new Error('Unable to fetch share codes for this session.');
    }

    state.session.editCode = editCode;
    state.session.viewCode = viewCode;
    storeSession({
      gameId: state.session.gameId,
      role: state.session.role,
      editCode: state.session.editCode || '',
      viewCode: state.session.viewCode || ''
    });
    updateUiForSession();
    return {
      viewCode,
      editCode
    };
  }

  async function ensureShareSessionWithViewCode() {
    const existingViewCode = normalizeCode(state.session?.viewCode || '');
    if (existingViewCode) return existingViewCode;

    if (state.session?.role === 'viewer') {
      throw new Error('View code unavailable in this view-only session.');
    }

    const codes = await ensureShareSessionCodes();
    return codes.viewCode;
  }

  async function ensureShareSessionWithEditCode() {
    const existingEditCode = normalizeCode(state.session?.editCode || '');
    if (existingEditCode) return existingEditCode;

    if (state.session?.role === 'viewer') {
      throw new Error("You don't have Scorekeeping Access for this session.");
    }

    const codes = await ensureShareSessionCodes();
    return codes.editCode;
  }

  async function shareLiveViewLink() {
    if (!state.user) throw new Error('Cloud auth is not ready yet.');

    setStatus('Cloud: preparing live share link...');
    const viewCode = await ensureShareSessionWithViewCode();
    const url = buildViewShareUrl(viewCode);
    const shareText = `Live golf scorecard (view-only). Code: ${viewCode}`;

    if (navigator.share) {
      await navigator.share({
        title: 'Live Golf Scorecard',
        text: shareText,
        url
      });
      setStatus(`Cloud: shared live view link • Game ${state.session?.gameId || ''}`);
      return;
    }

    const fallbackText = `${shareText}\n${url}`;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(fallbackText);
      setStatus('Cloud: live view link copied to clipboard');
      if (typeof window.announce === 'function') {
        window.announce('Live share link copied.');
      }
      return;
    }

    window.prompt('Copy this live view link', url);
    setStatus('Cloud: live view link ready');
  }

  function openQrModalFromText(text, title = 'Live Share QR', subtitleText = 'Scan to open the live view scorecard.') {
    if (typeof qrcode === 'undefined') {
      throw new Error('QR library unavailable. Refresh and try again.');
    }

    const modal = document.createElement('div');
    modal.id = 'cloudLiveQrModal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
      animation: fadeIn 0.2s ease;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background: white;
      color: #111;
      border-radius: 12px;
      max-width: 420px;
      width: 100%;
      padding: 20px;
      text-align: center;
      animation: slideUpFull 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
    `;

    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.cssText = 'margin: 0 0 10px 0;';

    const subtitle = document.createElement('p');
    subtitle.textContent = subtitleText;
    subtitle.style.cssText = 'margin: 0 0 14px 0; color: #555;';

    const qrWrap = document.createElement('div');
    qrWrap.style.cssText = 'display:flex; justify-content:center; margin: 10px 0 14px 0;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'btn';
    closeBtn.addEventListener('click', () => {
      card.style.animation = 'slideDownFull 0.18s cubic-bezier(0.4, 0, 1, 1) forwards';
      modal.style.animation = 'fadeOut 0.18s ease forwards';
      setTimeout(() => modal.remove(), 185);
    });

    card.appendChild(heading);
    card.appendChild(subtitle);
    card.appendChild(qrWrap);
    card.appendChild(closeBtn);
    modal.appendChild(card);
    document.body.appendChild(modal);

    const qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();

    const size = 260;
    const cellSize = Math.floor(size / qr.getModuleCount());
    const actualSize = cellSize * qr.getModuleCount();
    const canvas = document.createElement('canvas');
    canvas.width = actualSize;
    canvas.height = actualSize;
    const ctx = canvas.getContext('2d');

    for (let row = 0; row < qr.getModuleCount(); row++) {
      for (let col = 0; col < qr.getModuleCount(); col++) {
        ctx.fillStyle = qr.isDark(row, col) ? '#000000' : '#ffffff';
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }

    qrWrap.appendChild(canvas);
  }

  function extractCodeFromScannedQrText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return '';

    // If full URL (our current QR format), pull view/code query param.
    try {
      const url = new URL(text);
      const direct = normalizeCode(url.searchParams.get('view') || url.searchParams.get('code') || '');
      if (direct) return direct;
    } catch (_) {
      // Not a URL - continue with fallback parsers below.
    }

    // Fallback for partial URLs / copied query fragments.
    const queryMatch = text.match(/[?&](?:view|code)=([^&#\s]+)/i);
    if (queryMatch?.[1]) {
      try {
        return normalizeCode(decodeURIComponent(queryMatch[1]));
      } catch {
        return normalizeCode(queryMatch[1]);
      }
    }

    // Last resort: treat raw scan data as a direct access code.
    return normalizeCode(text);
  }

  async function scanJoinQrCodeAndJoin() {
    if (typeof jsQR === 'undefined') {
      throw new Error('QR scanner unavailable. Refresh and try again.');
    }

    const scannedText = await new Promise((resolve, reject) => {
      let rafId = null;
      let stream = null;
      let closed = false;

      const modal = document.createElement('div');
      modal.id = 'cloudJoinQrScanModal';
      modal.style.cssText = [
        'position: fixed',
        'inset: 0',
        'background: rgba(0,0,0,0.8)',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'z-index: 10010',
        'padding: 12px'
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'background: #111',
        'color: #fff',
        'border-radius: 12px',
        'width: min(94vw, 460px)',
        'padding: 12px 12px 10px',
        'box-sizing: border-box'
      ].join(';');

      const title = document.createElement('h2');
      title.textContent = 'Join via QR';
      title.style.cssText = 'margin: 0 0 8px 0; font-size: 20px;';

      const message = document.createElement('p');
      message.textContent = 'Point your camera at a live-share QR code.';
      message.style.cssText = 'margin: 0 0 10px 0; color: #c8cdd3; font-size: 13px;';

      const video = document.createElement('video');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('muted', 'true');
      video.autoplay = true;
      video.style.cssText = [
        'display: block',
        'width: 100%',
        'max-height: min(58vh, 360px)',
        'background: #000',
        'border-radius: 10px',
        'object-fit: cover'
      ].join(';');

      const canvas = document.createElement('canvas');
      canvas.style.display = 'none';

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex; justify-content:flex-end; margin-top:10px;';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'min-height: 40px;';
      actions.appendChild(cancelBtn);

      card.append(title, message, video, canvas, actions);
      modal.appendChild(card);
      document.body.appendChild(modal);

      const cleanup = () => {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        try {
          stream?.getTracks?.().forEach((t) => t.stop());
        } catch {}
        modal.remove();
      };

      const closeWithError = (err) => {
        if (closed) return;
        closed = true;
        cleanup();
        reject(err);
      };

      const closeWithResult = (value) => {
        if (closed) return;
        closed = true;
        cleanup();
        resolve(value);
      };

      cancelBtn.addEventListener('click', () => closeWithError(new Error('QR scan cancelled')));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeWithError(new Error('QR scan cancelled'));
      });

      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      }).then((s) => {
        stream = s;
        video.srcObject = s;
        return video.play();
      }).then(() => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const tick = () => {
          if (closed) return;
          if (video.readyState >= video.HAVE_ENOUGH_DATA) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w > 0 && h > 0) {
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);
              const result = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
              if (result?.data) {
                closeWithResult(result.data);
                return;
              }
            }
          }
          rafId = requestAnimationFrame(tick);
        };

        tick();
      }).catch((err) => {
        closeWithError(new Error(`Camera unavailable: ${err?.message || err}`));
      });
    });

    const code = extractCodeFromScannedQrText(scannedText);
    if (!code) {
      throw new Error('Scanned QR does not contain a valid join code.');
    }

    const joinInput = EL.joinCode();
    if (joinInput) joinInput.value = code;

    showJoinProgressOverlay('Checking access code...');
    try {
      await joinSessionWithCode(code, { showSuccessToast: false });
      completeJoinProgressOverlay(state.session?.role);
    } catch (err) {
      clearJoinProgressOverlay();
      throw err;
    }
  }

  async function generateLiveViewQrCode() {
    if (!state.user) throw new Error('Cloud auth is not ready yet.');

    setStatus('Cloud: preparing live QR...');
    const viewCode = await ensureShareSessionWithViewCode();
    const url = buildViewShareUrl(viewCode);
    openQrModalFromText(url, 'Live View QR', 'Scan to open the live scorecard in read-only mode.');
    setStatus(`Cloud: live QR ready • Game ${state.session?.gameId || ''}`);
  }

  async function generateLiveEditQrCode() {
    if (!state.user) throw new Error('Cloud auth is not ready yet.');

    const hasEditCode = !!normalizeCode(state.session?.editCode || '');
    if (state.session?.role === 'viewer' && !hasEditCode) {
      setStatus("Cloud: You don't have Scorekeeping Access. Sharing view-only QR.");
      if (typeof window.announce === 'function') {
        window.announce('No Scorekeeping Access. Sharing view-only QR.');
      }
      await generateLiveViewQrCode();
      return;
    }

    setStatus('Cloud: preparing edit QR...');
    const editCode = await ensureShareSessionWithEditCode();
    const url = buildEditShareUrl(editCode);
    openQrModalFromText(url, 'Live Edit QR', 'Scan to open the live scorecard with edit access. Share with trusted players only.');
    setStatus(`Cloud: live edit QR ready • Game ${state.session?.gameId || ''}`);
  }

  function updateUiForSession() {
    if (!state.session) {
      setStatus('Cloud: not connected');
      setCodesText('', false);
      state.snapshots = [];
      resetSnapshotReviewUi();
      syncViewerLock({ force: true, syncRows: false });
      return;
    }

    const role = state.session.role || 'viewer';
    setStatus(`Cloud: connected (${role}) • Game ${state.session.gameId}`);

    if (state.session.editCode || state.session.viewCode) {
      const parts = [];
      if (state.session.editCode) parts.push(`Edit code: ${state.session.editCode}`);
      if (state.session.viewCode) parts.push(`View code: ${state.session.viewCode}`);
      setCodesText(parts.join(' | '), true);
    } else {
      setCodesText('', false);
    }

    renderSnapshotOptions();
    syncSnapshotButtons();
    syncViewerLock({ force: true, syncRows: false });
  }

  function unbindRealtime() {
    if (state.unsubRef) {
      state.unsubRef.off();
      state.unsubRef = null;
    }

    if (state.snapshotListRef) {
      state.snapshotListRef.off();
      state.snapshotListRef = null;
    }
  }

  function resetToDisconnectedState() {
    unbindRealtime();
    clearTimeout(state.pushTimer);
    clearTimeout(state.pendingRemoteTimer);
    clearRemoteApplyResumeTimer();
    clearViewerLockMutationTimer();
    state.pendingRemoteTimer = null;
    state.pendingRemoteState = null;
    state.pushSuspended = false;
    state.remoteApplySuspendedUntil = 0;
    state.needsPostJoinAlignment = false;
    state.session = null;
    state.lastSeenRevision = 0;
    state.lastSnapshotAt = 0;
    state.currentLiveState = null;
    state.lastPushedContentHash = '';
    state.snapshots = [];
    storeSession(null);
    updateUiForSession();
  }

  function writeSnapshot(syncGame, source = 'auto') {
    if (!state.session || state.session.role !== 'editor' || !state.db || !syncGame) return Promise.resolve(null);

    const timestamp = Date.now();
    const gameRoot = `games/${state.session.gameId}`;
    const payload = {
      createdAt: timestamp,
      createdBy: state.user?.uid || 'unknown',
      revision: Number(syncGame?.meta?.revision) || 0,
      source,
      state: syncGame
    };

    state.lastSnapshotAt = timestamp;

    const snapshotRef = state.db.ref(`${gameRoot}/snapshots/${timestamp}`);
    const metaRef = state.db.ref(`${gameRoot}/meta`);

    return Promise.all([
      snapshotRef.set(payload),
      metaRef.update({ lastSnapshotAt: timestamp })
    ]).then(() => payload).catch((err) => {
      console.warn('[CloudSync] snapshot write failed:', err);
      return null;
    });
  }

  function maybeSnapshot(syncGame) {
    if (!state.session || state.session.role !== 'editor' || !state.db || !syncGame) return Promise.resolve();
    const now = Date.now();
    if (now - state.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return Promise.resolve();

    return writeSnapshot(syncGame, 'auto').then(() => undefined);
  }

  async function pushNow(options = {}) {
    if (!state.session || state.session.role !== 'editor' || state.isApplyingRemote) return;
    const syncGame = window.GolfApp?.storage?.getSyncGameState?.();
    if (!syncGame) return;

    const { forceSnapshot = false, snapshotSource = 'auto' } = options;
    const contentHash = getSyncContentHash(syncGame);
    if (!forceSnapshot && contentHash && contentHash === state.lastPushedContentHash) {
      return;
    }

    const now = Date.now();
    const baseRevision = Number(syncGame?.meta?.revision) || 0;
    const nextRevision = Math.max(baseRevision, state.lastSeenRevision) + 1;

    syncGame.meta = {
      ...(syncGame.meta || {}),
      schemaVersion: Number(syncGame?.meta?.schemaVersion) || 1,
      createdAt: Number(syncGame?.meta?.createdAt) || now,
      updatedAt: now,
      updatedBy: state.user?.uid || 'local-client',
      revision: nextRevision
    };

    const gameRoot = `games/${state.session.gameId}`;

    const prevSyncState = (state.currentLiveState && typeof state.currentLiveState === 'object')
      ? state.currentLiveState
      : null;

    const metaRef = state.db.ref(`${gameRoot}/meta`);
    const liveStateRef = state.db.ref(`${gameRoot}/state`);

    if (!prevSyncState) {
      await liveStateRef.set(syncGame);
    } else {
      const stateUpdates = {};
      buildDiffUpdates(prevSyncState, syncGame, '', stateUpdates);
      if (Object.keys(stateUpdates).length > 0) {
        await liveStateRef.update(stateUpdates);
      }
    }

    await metaRef.update({
      updatedAt: now,
      updatedBy: state.user?.uid || 'local-client'
    });

    state.lastSeenRevision = nextRevision;
    state.currentLiveState = syncGame;
    state.lastPushAt = now;
    state.lastPushedContentHash = contentHash;

    if (forceSnapshot) {
      await writeSnapshot(syncGame, snapshotSource);
    } else {
      await maybeSnapshot(syncGame);
    }
  }

  function queuePush(reason = 'local-change') {
    if (!state.session || state.session.role !== 'editor' || state.isViewingSnapshot || state.pushSuspended) return;
    clearTimeout(state.pushTimer);

    const elapsed = Date.now() - (state.lastPushAt || 0);
    const delay = Math.max(PUSH_DEBOUNCE_MS, MIN_PUSH_INTERVAL_MS - Math.max(0, elapsed));

    state.pushTimer = setTimeout(() => {
      pushNow().catch((err) => {
        console.error(`[CloudSync] push failed (${reason}):`, err);
        const code = String(err?.code || '').toLowerCase();
        const msg = String(err?.message || '').toLowerCase();
        if (code.includes('permission_denied') || msg.includes('permission denied')) {
          state.pushSuspended = true;
          setStatus('Cloud: write blocked (permission denied)');
          return;
        }
        setStatus('Cloud: push failed (see console)');
      });
    }, delay);
  }

  function patchStorageSaveHook() {
    const storage = window.GolfApp?.storage;
    if (!storage || state.originalSave) return;

    state.originalSave = storage.save.bind(storage);
    storage.save = function(...args) {
      const ok = state.originalSave(...args);
      if (ok && !state.isApplyingRemote && !state.isViewingSnapshot) {
        queuePush('storage-save');
      }
      return ok;
    };
  }

  function isBankerInputFocused() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;

    if (active.classList.contains('banker-bet-input') || active.classList.contains('banker-maxbet-input')) {
      return true;
    }

    if (typeof active.id === 'string' && active.id.startsWith('banker_')) {
      return true;
    }

    return false;
  }

  function isBankerInteractionActive() {
    return Date.now() - state.lastBankerInteractionAt < BANKER_REMOTE_APPLY_GRACE_MS;
  }

  function markBankerInteraction(target) {
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('#bankerSection')) {
      state.lastBankerInteractionAt = Date.now();
    }
  }

  function isGameInteractionActive() {
    return Date.now() - state.lastGameInteractionAt < GAME_REMOTE_APPLY_GRACE_MS;
  }

  function markGameInteraction(target) {
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(GAME_INTERACTION_SECTIONS) || target.closest(GAME_TAB_INTERACTION_SELECTORS)) {
      state.lastGameInteractionAt = Date.now();
    }
  }

  function applyRemoteStateToUi(syncGame, revision = 0) {
    state.isApplyingRemote = true;
    try {
      const ok = window.GolfApp?.storage?.applySyncGameState?.(syncGame, 'remote');
      if (!ok) {
        console.warn('[CloudSync] Failed to apply remote sync state');
      } else if (state.needsPostJoinAlignment) {
        state.needsPostJoinAlignment = false;
        scheduleScorecardAlignmentAfterJoin();
      }
      state.lastSeenRevision = Math.max(state.lastSeenRevision, Number(revision) || 0);
    } finally {
      state.isApplyingRemote = false;
      syncViewerLock();
    }
  }

  function flushPendingRemoteState() {
    if (state.pendingRemoteTimer) {
      clearTimeout(state.pendingRemoteTimer);
      state.pendingRemoteTimer = null;
    }

    if (!state.pendingRemoteState || state.isViewingSnapshot) {
      return;
    }

    if (isRemoteApplySuspended()) {
      const remaining = Math.max(24, state.remoteApplySuspendedUntil - Date.now() + 24);
      state.pendingRemoteTimer = setTimeout(flushPendingRemoteState, remaining);
      return;
    }

    if (isBankerInputFocused() || isBankerInteractionActive() || isGameInteractionActive()) {
      state.pendingRemoteTimer = setTimeout(flushPendingRemoteState, 500);
      return;
    }

    const pending = state.pendingRemoteState;
    state.pendingRemoteState = null;
    const revision = Number(pending?.meta?.revision) || 0;
    applyRemoteStateToUi(pending, revision);
  }

  function applyRemoteState(syncGame) {
    if (!syncGame || typeof syncGame !== 'object') return;

    const revision = Number(syncGame?.meta?.revision) || 0;
    if (revision && revision <= state.lastSeenRevision) {
      return;
    }

    const updatedBy = syncGame?.meta?.updatedBy;
    if (updatedBy && state.user?.uid && updatedBy === state.user.uid && revision <= state.lastSeenRevision) {
      return;
    }

    const incomingContentHash = getSyncContentHash(syncGame);
    const isUnchangedContent = !!incomingContentHash && incomingContentHash === state.lastPushedContentHash;

    state.currentLiveState = syncGame;
    if (incomingContentHash) {
      state.lastPushedContentHash = incomingContentHash;
    }

    if (isUnchangedContent) {
      if (state.needsPostJoinAlignment) {
        state.needsPostJoinAlignment = false;
        scheduleScorecardAlignmentAfterJoin();
      }
      state.lastSeenRevision = Math.max(state.lastSeenRevision, revision);
      return;
    }

    if (state.isViewingSnapshot) {
      state.lastSeenRevision = Math.max(state.lastSeenRevision, revision);
      setStatus(`Cloud: viewing snapshot • live updated to rev ${state.lastSeenRevision}`);
      return;
    }

    if (isRemoteApplySuspended()) {
      state.pendingRemoteState = syncGame;
      if (!state.pendingRemoteTimer) {
        const remaining = Math.max(24, state.remoteApplySuspendedUntil - Date.now() + 24);
        state.pendingRemoteTimer = setTimeout(flushPendingRemoteState, remaining);
      }
      return;
    }

    if (isBankerInputFocused() || isBankerInteractionActive() || isGameInteractionActive()) {
      state.pendingRemoteState = syncGame;
      if (!state.pendingRemoteTimer) {
        state.pendingRemoteTimer = setTimeout(flushPendingRemoteState, 500);
      }
      return;
    }

    applyRemoteStateToUi(syncGame, revision);
  }

  function bindSnapshotList(gameId) {
    if (!state.db) return;

    if (state.snapshotListRef) {
      state.snapshotListRef.off();
      state.snapshotListRef = null;
    }

    const ref = state.db.ref(`games/${gameId}/snapshots`).limitToLast(SNAPSHOT_LIST_LIMIT);
    state.snapshotListRef = ref;
    ref.on('value', (snap) => {
      const value = snap.val() || {};
      const snapshots = Object.entries(value)
        .map(([id, snapshot]) => ({ id, ...(snapshot || {}) }))
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      state.snapshots = snapshots;
      renderSnapshotOptions();
      syncSnapshotButtons();
    }, (err) => {
      console.error('[CloudSync] snapshot list error:', err);
    });
  }

  async function reviewSelectedSnapshot() {
    const snapshotId = EL.snapshotSelect()?.value || '';
    if (!snapshotId) {
      resetSnapshotReviewUi();
      if (state.currentLiveState) {
        window.GolfApp?.storage?.applySyncGameState?.(state.currentLiveState, 'remote');
      }
      setStatus(`Cloud: connected (${state.session?.role || 'viewer'}) • Game ${state.session?.gameId}`);
      return;
    }

    const snapshot = getSnapshotById(snapshotId);
    if (!snapshot?.state) {
      throw new Error('Snapshot not found');
    }

    state.isViewingSnapshot = true;
    state.activeSnapshotId = snapshotId;

    const ok = window.GolfApp?.storage?.applySyncGameState?.(snapshot.state, 'snapshot');
    if (!ok) {
      throw new Error('Failed to load snapshot');
    }

    setStatus(`Cloud: reviewing snapshot • Game ${state.session?.gameId}`);
    setSnapshotStatus(`Snapshot loaded: ${formatSnapshotLabel(snapshot)}. Edits stay local until saved as current.`, true);
    renderSnapshotOptions();
    syncSnapshotButtons();
  }

  async function resumeLiveState() {
    if (!state.currentLiveState) {
      resetSnapshotReviewUi();
      updateUiForSession();
      return;
    }

    const ok = window.GolfApp?.storage?.applySyncGameState?.(state.currentLiveState, 'remote');
    if (!ok) {
      throw new Error('Failed to restore live state');
    }

    resetSnapshotReviewUi();
    updateUiForSession();
  }

  async function saveReviewedSnapshotAsCurrent() {
    if (!state.session || state.session.role !== 'editor') {
      throw new Error('Editor access required');
    }
    if (!state.isViewingSnapshot) {
      throw new Error('Load a snapshot first');
    }

    setStatus('Cloud: saving reviewed snapshot...');
    await pushNow({ forceSnapshot: true, snapshotSource: 'manual-restore' });
    resetSnapshotReviewUi();
    updateUiForSession();
    setSnapshotStatus('Snapshot saved as the new current live version.', true);
  }

  async function subscribeRealtime(gameId) {
    if (!state.db) return;
    unbindRealtime();
    state.currentLiveState = null;
    state.lastPushedContentHash = '';
    state.lastSeenRevision = 0;

    const metaSnap = await state.db.ref(`games/${gameId}/meta/lastSnapshotAt`).get().catch(() => null);
    state.lastSnapshotAt = Number(metaSnap?.val?.() ?? 0) || 0;
    bindSnapshotList(gameId);

    const ref = state.db.ref(`games/${gameId}/state`);
    state.unsubRef = ref;

    // Explicit initial hydrate so join never waits for the next live write.
    // Some mobile/browser cases can delay the first realtime callback.
    try {
      const initialSnap = await ref.get();
      const initialState = initialSnap?.val?.();
      if (initialState) {
        applyRemoteState(initialState);
      } else if (state.session?.role === 'editor') {
        // Seed a newly created or empty session immediately so viewers can hydrate
        // without waiting for the next local edit/save on the host device.
        await pushNow();
      }
    } catch (err) {
      console.warn('[CloudSync] initial state fetch failed:', err);
    }

    ref.on('value', (snap) => {
      const data = snap.val();
      if (!data) return;
      applyRemoteState(data);
    }, (err) => {
      console.error('[CloudSync] realtime subscription error:', err);
      setStatus('Cloud: realtime error');
    });
  }

  async function createSession() {
    if (!state.user) throw new Error('Not authenticated');

    const payload = buildCreatePayload();
    let result;
    try {
      result = await callFunction('createGameSession', payload);
    } catch (err) {
      throw new Error('createGameSession function failed. Deploy Cloud Functions first.');
    }

    if (!result?.gameId || !result?.editCode || !result?.viewCode) {
      throw new Error('Invalid createGameSession response');
    }

    state.session = {
      gameId: result.gameId,
      role: 'editor',
      editCode: result.editCode,
      viewCode: result.viewCode
    };
    state.pushSuspended = false;

    storeSession({
      gameId: result.gameId,
      role: 'editor',
      editCode: normalizeCode(result.editCode || ''),
      viewCode: normalizeCode(result.viewCode || '')
    });
    updateUiForSession();
    await subscribeRealtime(result.gameId);
  }

  async function joinSessionWithCode(rawCode, options = {}) {
    const { showSuccessToast = true } = options;
    if (!state.user) throw new Error('Not authenticated');

    const code = normalizeCode(rawCode);
    if (!code) throw new Error('Enter a valid code');

    let result;
    try {
      result = await callFunction('redeemGameCode', { code });
    } catch (err) {
      const msg = err?.message || String(err);
      // Surface the real error rather than the generic "deploy functions" message
      if (msg.toLowerCase().includes('app-check') || msg.toLowerCase().includes('appcheck') || msg.toLowerCase().includes('attestation')) {
        throw new Error('App Check verification failed. Try refreshing the page.');
      }
      if (msg.toLowerCase().includes('unauthenticated') || msg.toLowerCase().includes('not authenticated')) {
        throw new Error('Not signed in. Refresh and try again.');
      }
      if (msg.toLowerCase().includes('not-found') || msg.toLowerCase().includes('not found')) {
        throw new Error('Code not found or expired.');
      }
      if (msg.toLowerCase().includes('resource-exhausted') || msg.toLowerCase().includes('too many')) {
        throw new Error('Too many attempts. Wait a few minutes and try again.');
      }
      console.error('[CloudSync] redeemGameCode error:', err);
      throw new Error(`Join failed: ${msg}`);
    }

    if (!result?.gameId || !result?.role) {
      throw new Error('Invalid redeemGameCode response');
    }

    try {
      state.session = {
        gameId: result.gameId,
        role: result.role === 'editor' ? 'editor' : 'viewer',
        editCode: normalizeCode(result.editCode || ''),
        viewCode: normalizeCode(result.viewCode || '')
      };
      state.pushSuspended = false;

      storeSession({
        gameId: result.gameId,
        role: state.session.role,
        editCode: state.session.editCode || '',
        viewCode: state.session.viewCode || ''
      });
      window.GolfApp?.storage?.prepareForIncomingSyncState?.(undefined, { resetSharedGames: false });
      updateUiForSession();
      updateJoinProgressOverlay('Loading live scorecard...');
      state.needsPostJoinAlignment = true;
      await subscribeRealtime(result.gameId);
      if (showSuccessToast) {
        showJoinSuccessToast(state.session.role);
      }
    } catch (err) {
      resetToDisconnectedState();
      throw err;
    }
  }

  async function leaveSession() {
    resetToDisconnectedState();
  }

  // =============================================================================
  // UI BINDINGS
  // =============================================================================

  /**
   * Shared wrapper for async cloud button actions.
   * Shows a working status, catches errors, and surfaces them in the status bar.
   * @param {string} tag - Label for console error context
   * @param {string|null} workingMsg - Optional status message shown before the async work
   * @param {() => Promise<void>} fn - Async action to run
   * @returns {() => void} Click handler
   */
  function withCloudOp(tag, workingMsg, fn) {
    return async () => {
      try {
        if (workingMsg) setStatus(workingMsg);
        await fn();
      } catch (err) {
        console.error(`[CloudSync] ${tag}:`, err);
        setStatus(`Cloud: ${err.message}`);
      }
    };
  }

  function bindUi() {
    ensureViewerLockObserver();
    enforceViewerReadOnlyGuards();

    // Auto-open utilities panel when a join code is in the URL
    if (getCodeFromUrl()) {
      const utilitiesSection = document.getElementById('utilitiesSection');
      if (utilitiesSection) utilitiesSection.classList.add('open');
    }

    window.addEventListener('pageshow', () => syncViewerLock({ force: true, syncRows: false }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncViewerLock({ force: true, syncRows: false });
    });

    document.addEventListener('pointerdown', (e) => {
      markBankerInteraction(e.target);
      markGameInteraction(e.target);
    }, true);
    document.addEventListener('focusin', (e) => {
      markBankerInteraction(e.target);
      markGameInteraction(e.target);
    }, true);
    document.addEventListener('change', (e) => markGameInteraction(e.target), true);
    document.addEventListener('golf:game-tab-changed', () => {
      state.lastGameInteractionAt = Date.now();
    });

    EL.createBtn()?.addEventListener('click',
      withCloudOp('create session', 'Cloud: creating session...', createSession));

    EL.joinBtn()?.addEventListener('click',
      withCloudOp('join session', null, async () => {
        const code = EL.joinCode()?.value || '';
        showJoinProgressOverlay('Checking access code...');
        try {
          await joinSessionWithCode(code, { showSuccessToast: false });
          completeJoinProgressOverlay(state.session?.role);
        } catch (err) {
          clearJoinProgressOverlay();
          throw err;
        }
      }));

    EL.leaveBtn()?.addEventListener('click', () => leaveSession());

    EL.createBadgeBtn()?.addEventListener('click',
      withCloudOp('toggle live session (badge)', null, async () => {
        if (state.session) {
          setStatus('Cloud: leaving session...');
          await leaveSession();
          return;
        }
        setStatus('Cloud: creating session...');
        await createSession();
      }));

    EL.qrBadgeBtn()?.addEventListener('click',
      withCloudOp('share QR (badge)', null, async () => {
        const hasEditCode = !!normalizeCode(state.session?.editCode || '');
        if (state.session?.role === 'viewer' && !hasEditCode) {
          setStatus("Cloud: You don't have Scorekeeping Access. Sharing view-only QR.");
          if (typeof window.announce === 'function') {
            window.announce('No Scorekeeping Access. Sharing view-only QR.');
          }
          await generateLiveViewQrCode();
          return;
        }

        const mode = await chooseQrShareMode();
        if (!mode) return;
        if (mode === 'edit') {
          await generateLiveEditQrCode();
        } else {
          await generateLiveViewQrCode();
        }
      }));

    EL.joinQrBadgeBtn()?.addEventListener('click',
      withCloudOp('join QR (badge)', null, async () => {
        try {
          await scanJoinQrCodeAndJoin();
        } catch (err) {
          const msg = String(err?.message || err || '').toLowerCase();
          if (msg.includes('cancelled')) return;
          throw err;
        }
      }));

    EL.joinQrBtn()?.addEventListener('click',
      withCloudOp('join QR', null, async () => {
        try {
          await scanJoinQrCodeAndJoin();
        } catch (err) {
          const msg = String(err?.message || err || '').toLowerCase();
          if (msg.includes('cancelled')) return;
          throw err;
        }
      }));

    EL.editCodeBadgeBtn()?.addEventListener('click',
      withCloudOp('share edit link (badge)', null, () => shareSessionLink('edit')));

    EL.viewCodeBadgeBtn()?.addEventListener('click',
      withCloudOp('share view link (badge)', null, () => shareSessionLink('view')));

    EL.snapshotSelect()?.addEventListener('change', () => {
      state.activeSnapshotId = EL.snapshotSelect()?.value || '';
      syncSnapshotButtons();
    });

    EL.loadSnapshotBtn()?.addEventListener('click',
      withCloudOp('snapshot review', 'Cloud: loading snapshot...', reviewSelectedSnapshot));

    EL.resumeLiveBtn()?.addEventListener('click',
      withCloudOp('resume live', 'Cloud: returning to live...', resumeLiveState));

    EL.saveSnapshotBtn()?.addEventListener('click',
      withCloudOp('save reviewed snapshot', null, saveReviewedSnapshotAsCurrent));

    syncHeaderCodeBadgeButtons();
  }

  async function initFirebase() {
    if (!hasFirebaseConfig() || !window.firebase) {
      setStatus('Cloud: Firebase not configured');
      setCodesText('Add config in js/firebase-config.js to enable cloud sync.', true);
      return false;
    }

    try {
      if (!window.firebase.apps.length) {
        state.app = window.firebase.initializeApp(window.FIREBASE_CONFIG);
      } else {
        state.app = window.firebase.app();
      }

      state.auth = window.firebase.auth();
      state.db = window.firebase.database();

      const appCheckSiteKey = String(window.FIREBASE_APPCHECK_SITE_KEY || '').trim();
      if (!appCheckSiteKey) {
        setStatus('Cloud: App Check key missing');
        setCodesText('Set FIREBASE_APPCHECK_SITE_KEY in js/firebase-config.js', true);
        return false;
      }

      if (window.FIREBASE_APPCHECK_DEBUG_TOKEN) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = window.FIREBASE_APPCHECK_DEBUG_TOKEN;
      }

      if (typeof window.firebase.appCheck === 'function') {
        state.appCheck = window.firebase.appCheck(state.app);
        state.appCheck.activate(appCheckSiteKey, true);
      } else {
        setStatus('Cloud: Firebase App Check SDK missing');
        setCodesText('Load firebase-app-check-compat.js in index.html', true);
        return false;
      }

      const region = window.FIREBASE_FUNCTIONS_REGION || 'us-central1';
      state.functions = window.firebase.functions(state.app, region);

      if (window.FIREBASE_USE_EMULATORS) {
        try {
          state.auth.useEmulator('http://127.0.0.1:9099');
          state.db.useEmulator('127.0.0.1', 9000);
          state.functions.useEmulator('127.0.0.1', 5001);
        } catch (err) {
          console.warn('[CloudSync] Emulator setup warning:', err);
        }
      }

      const authResult = await state.auth.signInAnonymously();
      state.user = authResult?.user || state.auth.currentUser;

      setStatus('Cloud: ready');
      return true;
    } catch (err) {
      console.error('[CloudSync] Firebase init failed:', err);
      setStatus('Cloud: init failed (see console)');
      return false;
    }
  }

  async function restoreSession() {
    const stored = readStoredSession();
    if (!stored?.gameId || !stored?.role) {
      updateUiForSession();
      return;
    }

    state.session = {
      gameId: stored.gameId,
      role: stored.role === 'editor' ? 'editor' : 'viewer',
      editCode: normalizeCode(stored.editCode || ''),
      viewCode: normalizeCode(stored.viewCode || '')
    };
    state.pushSuspended = false;

    updateUiForSession();
    state.needsPostJoinAlignment = true;
    await subscribeRealtime(state.session.gameId);
  }

  function focusScorecardAfterUrlJoin() {
    const utilitiesSection = document.getElementById('utilitiesSection');
    if (utilitiesSection) {
      utilitiesSection.classList.remove('open');
    }

    const scoreBtn = document.getElementById('entrySwitcherScoreBtn');
    if (scoreBtn) {
      scoreBtn.click();
    } else {
      const scorePanel = document.getElementById('scoreEntryPanel');
      const gamesPanel = document.getElementById('gamesEntryPanel');
      if (scorePanel) scorePanel.hidden = false;
      if (gamesPanel) gamesPanel.hidden = true;
    }

    const scorecard = document.getElementById('main-scorecard');
    if (scorecard) {
      requestAnimationFrame(() => {
        scorecard.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }

    scheduleScorecardAlignmentAfterJoin();
  }

  function scheduleScorecardAlignmentAfterJoin() {
    let hasDispatchedResize = false;

    const runSync = () => {
      const sync = window.GolfApp?.scorecard?.build?.syncRowHeights;
      if (typeof sync === 'function') {
        try {
          sync(true);
        } catch (err) {
          console.warn('[CloudSync] post-join row-height sync failed:', err);
        }
      }
    };

    const checkAlignment = () => {
      const scoreTable = document.getElementById('scorecard');
      if (!scoreTable) {
        return { aligned: true, checked: false, maxDelta: 0, pairs: 0 };
      }

      return {
        aligned: true,
        checked: true,
        maxDelta: 0,
        pairs: scoreTable.rows?.length || 0
      };
    };

    const runPass = (label) => {
      runSync();
      const result = checkAlignment();
      if (!result.checked || result.aligned) {
        return;
      }

      // If any rows are still out of sync, force one more pass after layout settles.
      requestAnimationFrame(runSync);
      setTimeout(runSync, 24);

      // Nudge listeners that depend on viewport/layout changes once per join.
      if (!hasDispatchedResize) {
        hasDispatchedResize = true;
        window.dispatchEvent(new Event('resize'));
      }

      console.warn(
        `[CloudSync] post-join alignment retry (${label}): max row delta=${result.maxDelta}px across ${result.pairs} rows`
      );
    };

    requestAnimationFrame(() => runPass('raf'));
    setTimeout(() => runPass('80ms'), 80);
    setTimeout(() => runPass('220ms'), 220);
    setTimeout(() => runPass('520ms'), 520);
    setTimeout(() => runPass('900ms'), 900);
  }

  async function joinSessionFromUrlIfPresent() {
    const code = getCodeFromUrl();
    if (!code) return false;

    try {
      updateJoinProgressOverlay('Checking access code...');
      await joinSessionWithCode(code, { showSuccessToast: false });
      clearCodeFromUrl();
      focusScorecardAfterUrlJoin();
      setStatus(`Cloud: joined from shared link (${state.session?.role || 'viewer'})`);
      completeJoinProgressOverlay(state.session?.role);
      return true;
    } catch (err) {
      console.error('[CloudSync] Failed to join session from URL code:', err);
      // Pre-fill the join input so the user can retry manually
      const joinInput = EL.joinCode();
      if (joinInput) joinInput.value = code;
      setStatus(`Cloud: couldn't auto-join (${err.message}). Tap Join to retry.`);
      clearJoinProgressOverlay();
      return false;
    }
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    bindUi();
    patchStorageSaveHook();

    const urlJoinCode = getCodeFromUrl();
    if (urlJoinCode) {
      showJoinProgressOverlay('Connecting to cloud services...');
    }

    const ok = await initFirebase();
    if (!ok) {
      resetToDisconnectedState();
      clearJoinProgressOverlay();
      // Still pre-fill join code from URL so user can retry once cloud is ready
      const code = getCodeFromUrl();
      const joinInput = EL.joinCode();
      if (code && joinInput) joinInput.value = code;
      return;
    }

    const joinedFromUrl = await joinSessionFromUrlIfPresent();
    if (!joinedFromUrl) {
      clearJoinProgressOverlay();
      await restoreSession();
    }
  }

  window.CloudSync = {
    init,
    createSession,
    joinSessionWithCode,
    leaveSession,
    shareLiveViewLink,
    generateLiveViewQrCode,
    generateLiveEditQrCode,
    queuePush,
    suspendRemoteApplies,
    resumeRemoteApplies,
    getSession: () => state.session,
    isApplyingRemote: () => state.isApplyingRemote,
    refreshHeaderBadgeButtons: syncHeaderCodeBadgeButtons,
    /**
     * Block all outgoing cloud pushes immediately (cancels any pending push timer too).
     * Call this before beginning a destructive local operation so no stale or partial
     * state reaches the cloud.  The cloud retains whatever was last pushed.
     * Pair with resumePushes() if the operation is cancelled.
     */
    suspendPushes() {
      clearTimeout(state.pushTimer);
      state.pushSuspended = true;
    },
    /** Re-enable cloud pushes after a cancelled destructive operation. */
    resumePushes() {
      state.pushSuspended = false;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error('[CloudSync] init error:', err);
      setStatus('Cloud: init error');
    });
  });
})();
