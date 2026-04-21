(() => {
  'use strict';

  const CLOUD_SESSION_KEY = 'golf_cloud_session_v1';
  const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

  const EL = {
    createBtn: () => document.getElementById('cloudCreateBtn'),
    joinBtn: () => document.getElementById('cloudJoinBtn'),
    leaveBtn: () => document.getElementById('cloudLeaveBtn'),
    joinCode: () => document.getElementById('cloudJoinCode'),
    status: () => document.getElementById('cloudStatus'),
    codes: () => document.getElementById('cloudCodes')
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
    isApplyingRemote: false,
    pushTimer: null,
    lastSeenRevision: 0,
    lastSnapshotAt: 0,
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
  }

  function unbindRealtime() {
    if (state.unsubRef) {
      state.unsubRef.off();
      state.unsubRef = null;
    }
  }

  function maybeSnapshot(syncGame) {
    if (!state.session || state.session.role !== 'editor' || !state.db || !syncGame) return Promise.resolve();
    const now = Date.now();
    if (now - state.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return Promise.resolve();

    const snapshotPath = `games/${state.session.gameId}/snapshots/${now}`;
    const metaPath = `games/${state.session.gameId}/meta/lastSnapshotAt`;
    state.lastSnapshotAt = now;

    return Promise.all([
      state.db.ref(snapshotPath).set({
        createdAt: now,
        createdBy: state.user?.uid || 'unknown',
        revision: Number(syncGame?.meta?.revision) || 0,
        state: syncGame
      }),
      state.db.ref(metaPath).set(now)
    ]).catch((err) => {
      console.warn('[CloudSync] snapshot write failed:', err);
    });
  }

  async function pushNow() {
    if (!state.session || state.session.role !== 'editor' || state.isApplyingRemote) return;
    const syncGame = window.GolfApp?.storage?.getSyncGameState?.();
    if (!syncGame) return;

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
    await maybeSnapshot(syncGame);
  }

  function queuePush(reason = 'local-change') {
    if (!state.session || state.session.role !== 'editor') return;
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
      if (ok && !state.isApplyingRemote) {
        queuePush('storage-save');
      }
      return ok;
    };
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

    state.isApplyingRemote = true;
    try {
      const ok = window.GolfApp?.storage?.applySyncGameState?.(syncGame, 'remote');
      if (!ok) {
        console.warn('[CloudSync] Failed to apply remote sync state');
      }
      state.lastSeenRevision = Math.max(state.lastSeenRevision, revision);
    } finally {
      state.isApplyingRemote = false;
    }
  }

  async function subscribeRealtime(gameId) {
    if (!state.db) return;
    unbindRealtime();

    const metaSnap = await state.db.ref(`games/${gameId}/meta/lastSnapshotAt`).get().catch(() => null);
    state.lastSnapshotAt = Number(metaSnap?.val?.() ?? metaSnap?.val?.lastSnapshotAt ?? 0) || 0;

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
    state.session = null;
    state.lastSeenRevision = 0;
    state.lastSnapshotAt = 0;
    storeSession(null);
    updateUiForSession();
  }

  function bindUi() {
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
