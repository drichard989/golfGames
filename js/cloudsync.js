(() => {
  'use strict';

  const CLOUD_SESSION_KEY = 'golf_cloud_session_v1';
  const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
  const BANKER_REMOTE_APPLY_GRACE_MS = 1200;
  const PUSH_DEBOUNCE_MS = 900;
  const MIN_PUSH_INTERVAL_MS = 1200;
  const SNAPSHOT_LIST_LIMIT = 20;
  const VIEWER_LOCK_FEEDBACK_INTERVAL_MS = 1500;

  const EL = {
    createBtn: () => document.getElementById('cloudCreateBtn'),
    joinBtn: () => document.getElementById('cloudJoinBtn'),
    leaveBtn: () => document.getElementById('cloudLeaveBtn'),
    joinCode: () => document.getElementById('cloudJoinCode'),
    snapshotSelect: () => document.getElementById('cloudSnapshotSelect'),
    loadSnapshotBtn: () => document.getElementById('cloudLoadSnapshotBtn'),
    resumeLiveBtn: () => document.getElementById('cloudResumeLiveBtn'),
    saveSnapshotBtn: () => document.getElementById('cloudSaveSnapshotBtn'),
    viewModeScorecardBanner: () => document.getElementById('viewModeScorecardBanner'),
    viewModeGamesBanner: () => document.getElementById('viewModeGamesBanner'),
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
    '#fontSizeSmall',
    '#fontSizeMedium',
    '#fontSizeLarge',
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
    '#hiloSection button'
  ];

  const VIEWER_ALLOWED_CLICK_IDS = new Set([
    'toggleVegas',
    'toggleBanker',
    'toggleSkins',
    'toggleJunk',
    'toggleHilo',
    'gamesLauncherBtn',
    'scorecardLauncherBtn'
  ]);

  const VIEWER_BLOCK_CONTAINERS = '#main-scorecard, #vegasSection, #bankerSection, #skinsSection, #junkSection, #hiloSection';

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
    lastSeenRevision: 0,
    lastSnapshotAt: 0,
    currentLiveState: null,
    activeSnapshotId: '',
    snapshots: [],
    originalSave: null,
    lastPushAt: 0,
    lastPushedContentHash: '',
    lockObserver: null,
    lastViewerBlockedNoticeAt: 0
  };

  function setStatus(msg) {
    const statusEl = EL.status();
    if (statusEl) statusEl.textContent = msg;
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

    const gamesBanner = EL.viewModeGamesBanner();
    if (gamesBanner) {
      gamesBanner.style.display = visible ? '' : 'none';
    }
  }

  function setViewerLockEnabled(enabled) {
    const nodes = Array.from(document.querySelectorAll(VIEWER_LOCK_SELECTORS.join(',')));
    nodes.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;

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

    if (eventType === 'click') {
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
      syncViewerLock();
      setStatus('Cloud: connected (viewer) • Read-only mode');
      notifyViewerReadOnly();
    };

    document.addEventListener('beforeinput', guard, true);
    document.addEventListener('input', guard, true);
    document.addEventListener('change', guard, true);
    document.addEventListener('click', guard, true);
    document.addEventListener('keydown', guard, true);
  }

  function ensureViewerLockObserver() {
    if (state.lockObserver || typeof MutationObserver === 'undefined') return;
    if (!document.body) return;

    const syncRowHeights = () => {
      const sync = window.GolfApp?.scorecard?.build?.syncRowHeights;
      if (typeof sync === 'function') {
        requestAnimationFrame(() => sync(true));
      }
    };

    state.lockObserver = new MutationObserver(() => {
      if (!isViewerSession()) return;
      setViewerLockEnabled(true);
      setViewModeBannersVisible(true);
      syncRowHeights();
    });

    state.lockObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function syncViewerLock() {
    const shouldLock = state.session?.role === 'viewer';
    setViewerLockEnabled(shouldLock);
    setViewModeBannersVisible(shouldLock);

    const sync = window.GolfApp?.scorecard?.build?.syncRowHeights;
    if (typeof sync === 'function') {
      requestAnimationFrame(() => sync(true));
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

  async function callFunction(name, data) {
    const fns = getFunctions();
    if (!fns) throw new Error('Cloud Functions unavailable');
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
    const codes = await ensureShareSessionCodes();
    return codes.viewCode;
  }

  async function ensureShareSessionWithEditCode() {
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
    closeBtn.addEventListener('click', () => modal.remove());

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
      syncViewerLock();
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
    syncViewerLock();
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

  function writeSnapshot(syncGame, source = 'auto') {
    if (!state.session || state.session.role !== 'editor' || !state.db || !syncGame) return Promise.resolve(null);

    const timestamp = Date.now();
    const snapshotPath = `games/${state.session.gameId}/snapshots/${timestamp}`;
    const payload = {
      createdAt: timestamp,
      createdBy: state.user?.uid || 'unknown',
      revision: Number(syncGame?.meta?.revision) || 0,
      source,
      state: syncGame
    };

    state.lastSnapshotAt = timestamp;

    const updates = {
      [snapshotPath]: payload,
      [`games/${state.session.gameId}/meta/lastSnapshotAt`]: timestamp
    };

    return state.db.ref().update(updates).then(() => payload).catch((err) => {
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

    const rootUpdates = {
      [`${gameRoot}/meta/updatedAt`]: now,
      [`${gameRoot}/meta/updatedBy`]: state.user?.uid || 'local-client'
    };

    if (!prevSyncState) {
      rootUpdates[`${gameRoot}/state`] = syncGame;
    } else {
      const stateUpdates = {};
      buildDiffUpdates(prevSyncState, syncGame, '', stateUpdates);
      Object.keys(stateUpdates).forEach((path) => {
        rootUpdates[`${gameRoot}/state/${path}`] = stateUpdates[path];
      });
    }

    await state.db.ref().update(rootUpdates);

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
    if (!state.session || state.session.role !== 'editor' || state.isViewingSnapshot) return;
    clearTimeout(state.pushTimer);

    const elapsed = Date.now() - (state.lastPushAt || 0);
    const delay = Math.max(PUSH_DEBOUNCE_MS, MIN_PUSH_INTERVAL_MS - Math.max(0, elapsed));

    state.pushTimer = setTimeout(() => {
      pushNow().catch((err) => {
        console.error(`[CloudSync] push failed (${reason}):`, err);
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

  function applyRemoteStateToUi(syncGame, revision = 0) {
    state.isApplyingRemote = true;
    try {
      const ok = window.GolfApp?.storage?.applySyncGameState?.(syncGame, 'remote');
      if (!ok) {
        console.warn('[CloudSync] Failed to apply remote sync state');
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

    if (isBankerInputFocused() || isBankerInteractionActive()) {
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

    state.currentLiveState = syncGame;
    state.lastPushedContentHash = getSyncContentHash(syncGame);

    if (state.isViewingSnapshot) {
      state.lastSeenRevision = Math.max(state.lastSeenRevision, revision);
      setStatus(`Cloud: viewing snapshot • live updated to rev ${state.lastSeenRevision}`);
      return;
    }

    if (state.session?.role === 'editor' && (isBankerInputFocused() || isBankerInteractionActive())) {
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

    const metaSnap = await state.db.ref(`games/${gameId}/meta/lastSnapshotAt`).get().catch(() => null);
    state.lastSnapshotAt = Number(metaSnap?.val?.() ?? 0) || 0;
    bindSnapshotList(gameId);

    const ref = state.db.ref(`games/${gameId}/state`);
    state.unsubRef = ref;

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

    storeSession({
      gameId: result.gameId,
      role: 'editor',
      editCode: normalizeCode(result.editCode || ''),
      viewCode: normalizeCode(result.viewCode || '')
    });
    updateUiForSession();
    await subscribeRealtime(result.gameId);
  }

  async function joinSessionWithCode(rawCode) {
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

    state.session = {
      gameId: result.gameId,
      role: result.role === 'editor' ? 'editor' : 'viewer',
      editCode: normalizeCode(result.editCode || ''),
      viewCode: normalizeCode(result.viewCode || '')
    };

    storeSession({
      gameId: result.gameId,
      role: state.session.role,
      editCode: state.session.editCode || '',
      viewCode: state.session.viewCode || ''
    });
    window.GolfApp?.storage?.prepareForIncomingSyncState?.();
    updateUiForSession();
    await subscribeRealtime(result.gameId);
  }

  async function leaveSession() {
    unbindRealtime();
    clearTimeout(state.pushTimer);
    clearTimeout(state.pendingRemoteTimer);
    state.pendingRemoteTimer = null;
    state.pendingRemoteState = null;
    state.session = null;
    state.lastSeenRevision = 0;
    state.lastSnapshotAt = 0;
    state.currentLiveState = null;
    state.snapshots = [];
    storeSession(null);
    updateUiForSession();
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

    window.addEventListener('pageshow', () => syncViewerLock());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncViewerLock();
    });

    document.addEventListener('pointerdown', (e) => markBankerInteraction(e.target), true);
    document.addEventListener('focusin', (e) => markBankerInteraction(e.target), true);

    EL.createBtn()?.addEventListener('click',
      withCloudOp('create session', 'Cloud: creating session...', createSession));

    EL.joinBtn()?.addEventListener('click',
      withCloudOp('join session', 'Cloud: joining...', () =>
        joinSessionWithCode(EL.joinCode()?.value || '')));

    EL.leaveBtn()?.addEventListener('click', () => leaveSession());

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

    updateUiForSession();
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
  }

  async function joinSessionFromUrlIfPresent() {
    const code = getCodeFromUrl();
    if (!code) return false;

    try {
      await joinSessionWithCode(code);
      clearCodeFromUrl();
      focusScorecardAfterUrlJoin();
      setStatus(`Cloud: joined from shared link (${state.session?.role || 'viewer'})`);
      return true;
    } catch (err) {
      console.error('[CloudSync] Failed to join session from URL code:', err);
      // Pre-fill the join input so the user can retry manually
      const joinInput = EL.joinCode();
      if (joinInput) joinInput.value = code;
      setStatus(`Cloud: couldn't auto-join (${err.message}). Tap Join to retry.`);
      return false;
    }
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    bindUi();
    patchStorageSaveHook();

    const ok = await initFirebase();
    if (!ok) {
      // Still pre-fill join code from URL so user can retry once cloud is ready
      const code = getCodeFromUrl();
      const joinInput = EL.joinCode();
      if (code && joinInput) joinInput.value = code;
      return;
    }

    const joinedFromUrl = await joinSessionFromUrlIfPresent();
    if (!joinedFromUrl) {
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
    getSession: () => state.session,
    isApplyingRemote: () => state.isApplyingRemote
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => {
      console.error('[CloudSync] init error:', err);
      setStatus('Cloud: init error');
    });
  });
})();
