(() => {
  'use strict';

  const CLOUD_SESSION_KEY = 'golf_cloud_session_v1';
  const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
  const BANKER_REMOTE_APPLY_GRACE_MS = 1200;

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

  const state = {
    initialized: false,
    app: null,
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
    originalSave: null
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
    const selectors = [
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

    const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
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

  function syncViewerLock() {
    const shouldLock = state.session?.role === 'viewer';
    setViewerLockEnabled(shouldLock);
    setViewModeBannersVisible(shouldLock);
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

    return Promise.all([
      state.db.ref(snapshotPath).set(payload),
      state.db.ref(`games/${state.session.gameId}/meta/lastSnapshotAt`).set(timestamp)
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
    await state.db.ref(`${gameRoot}/state`).set(syncGame);
    await state.db.ref(`${gameRoot}/meta/updatedAt`).set(now);
    await state.db.ref(`${gameRoot}/meta/updatedBy`).set(state.user?.uid || 'local-client');

    state.lastSeenRevision = nextRevision;
    state.currentLiveState = syncGame;

    if (forceSnapshot) {
      await writeSnapshot(syncGame, snapshotSource);
    } else {
      await maybeSnapshot(syncGame);
    }
  }

  function queuePush(reason = 'local-change') {
    if (!state.session || state.session.role !== 'editor' || state.isViewingSnapshot) return;
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(() => {
      pushNow().catch((err) => {
        console.error(`[CloudSync] push failed (${reason}):`, err);
        setStatus('Cloud: push failed (see console)');
      });
    }, 400);
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

    const ref = state.db.ref(`games/${gameId}/snapshots`).limitToLast(50);
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
    state.lastSnapshotAt = Number(metaSnap?.val?.() ?? metaSnap?.val?.lastSnapshotAt ?? 0) || 0;
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

    storeSession({ gameId: result.gameId, role: 'editor' });
    updateUiForSession();
    await subscribeRealtime(result.gameId);
    queuePush('session-create');
  }

  async function joinSessionWithCode(rawCode) {
    if (!state.user) throw new Error('Not authenticated');

    const code = normalizeCode(rawCode);
    if (!code) throw new Error('Enter a valid code');

    let result;
    try {
      result = await callFunction('redeemGameCode', { code });
    } catch (err) {
      throw new Error('redeemGameCode function failed. Deploy Cloud Functions first.');
    }

    if (!result?.gameId || !result?.role) {
      throw new Error('Invalid redeemGameCode response');
    }

    state.session = {
      gameId: result.gameId,
      role: result.role === 'editor' ? 'editor' : 'viewer'
    };

    storeSession({ gameId: result.gameId, role: state.session.role });
    updateUiForSession();
    await subscribeRealtime(result.gameId);

    if (state.session.role === 'editor') {
      queuePush('session-join-editor');
    }
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

  function bindUi() {
    document.addEventListener('pointerdown', (e) => markBankerInteraction(e.target), true);
    document.addEventListener('focusin', (e) => markBankerInteraction(e.target), true);

    EL.createBtn()?.addEventListener('click', async () => {
      try {
        setStatus('Cloud: creating session...');
        await createSession();
      } catch (err) {
        console.error('[CloudSync] create session failed:', err);
        setStatus(`Cloud: ${err.message}`);
      }
    });

    EL.joinBtn()?.addEventListener('click', async () => {
      try {
        setStatus('Cloud: joining...');
        await joinSessionWithCode(EL.joinCode()?.value || '');
      } catch (err) {
        console.error('[CloudSync] join failed:', err);
        setStatus(`Cloud: ${err.message}`);
      }
    });

    EL.leaveBtn()?.addEventListener('click', async () => {
      await leaveSession();
    });

    EL.snapshotSelect()?.addEventListener('change', () => {
      state.activeSnapshotId = EL.snapshotSelect()?.value || '';
      syncSnapshotButtons();
    });

    EL.loadSnapshotBtn()?.addEventListener('click', async () => {
      try {
        setStatus('Cloud: loading snapshot...');
        await reviewSelectedSnapshot();
      } catch (err) {
        console.error('[CloudSync] snapshot review failed:', err);
        setStatus(`Cloud: ${err.message}`);
      }
    });

    EL.resumeLiveBtn()?.addEventListener('click', async () => {
      try {
        setStatus('Cloud: returning to live...');
        await resumeLiveState();
      } catch (err) {
        console.error('[CloudSync] resume live failed:', err);
        setStatus(`Cloud: ${err.message}`);
      }
    });

    EL.saveSnapshotBtn()?.addEventListener('click', async () => {
      try {
        await saveReviewedSnapshotAsCurrent();
      } catch (err) {
        console.error('[CloudSync] save reviewed snapshot failed:', err);
        setStatus(`Cloud: ${err.message}`);
      }
    });
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
      role: stored.role === 'editor' ? 'editor' : 'viewer'
    };

    updateUiForSession();
    await subscribeRealtime(state.session.gameId);

    if (state.session.role === 'editor') {
      queuePush('session-restore');
    }
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    bindUi();
    patchStorageSaveHook();

    const ok = await initFirebase();
    if (!ok) return;

    await restoreSession();
  }

  window.CloudSync = {
    init,
    createSession,
    joinSessionWithCode,
    leaveSession,
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
