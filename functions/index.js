const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.database();

const REGION = 'us-central1';
const CALLABLE_OPTS = { region: REGION, enforceAppCheck: true };
const EDIT_CODE_LENGTH = 8;
const VIEW_CODE_LENGTH = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_ATTEMPTS = 10;
const DATA_RETENTION_DAYS = 5;
const RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const RATE_LIMITS = {
  REDEEM_UID: {
    path: (uid) => `rateLimits/redeemByUid/${uid}`,
    windowMs: 5 * 60 * 1000,
    maxAttempts: 40,
    lockoutMs: 10 * 60 * 1000
  },
  REDEEM_IP: {
    path: (ipKey) => `rateLimits/redeemByIp/${ipKey}`,
    windowMs: 5 * 60 * 1000,
    maxAttempts: 120,
    lockoutMs: 10 * 60 * 1000
  },
  INVALID_UID: {
    path: (uid) => `rateLimits/redeemInvalidByUid/${uid}`,
    windowMs: 10 * 60 * 1000,
    maxAttempts: 10,
    lockoutMs: 30 * 60 * 1000
  },
  INVALID_IP: {
    path: (ipKey) => `rateLimits/redeemInvalidByIp/${ipKey}`,
    windowMs: 10 * 60 * 1000,
    maxAttempts: 30,
    lockoutMs: 30 * 60 * 1000
  }
};

function nowTs() {
  return Date.now();
}

function randomFromAlphabet(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function normalizeCode(code) {
  return String(code || '').trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeIpKey(ip) {
  const normalized = String(ip || '').trim();
  if (!normalized) return '';
  return normalized.replace(/[^a-zA-Z0-9:_\-]/g, '_');
}

function randomGameId() {
  return `g_${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 6)}`;
}

async function reserveUniqueCode(role, gameId, createdBy) {
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    const code = randomFromAlphabet(role === 'editor' ? EDIT_CODE_LENGTH : VIEW_CODE_LENGTH);
    const ref = db.ref(`codeMap/${code}`);

    let committed = false;
    await ref.transaction((current) => {
      if (current !== null) return;
      committed = true;
      return {
        gameId,
        role,
        createdAt: nowTs(),
        createdBy
      };
    });

    if (committed) return code;
  }

  throw new HttpsError('resource-exhausted', 'Unable to generate unique session code. Retry.');
}

function ensureAuthed(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  return request.auth.uid;
}

async function enforceRateLimit(path, { windowMs, maxAttempts, lockoutMs }, label) {
  const now = nowTs();
  const ref = db.ref(path);

  let blocked = false;
  let retryAfterMs = 0;

  await ref.transaction((current) => {
    const data = current && typeof current === 'object' ? current : {};
    const lockedUntil = Number(data.lockedUntil) || 0;
    if (lockedUntil > now) {
      blocked = true;
      retryAfterMs = lockedUntil - now;
      return;
    }

    const windowStart = Number(data.windowStart) || 0;
    const prevCount = Number(data.count) || 0;
    const sameWindow = windowStart > 0 && (now - windowStart) < windowMs;
    const count = sameWindow ? prevCount : 0;
    const nextCount = count + 1;

    if (nextCount > maxAttempts) {
      blocked = true;
      retryAfterMs = lockoutMs;
      return {
        windowStart: now,
        count: 0,
        lockedUntil: now + lockoutMs,
        updatedAt: now
      };
    }

    return {
      windowStart: sameWindow ? windowStart : now,
      count: nextCount,
      lockedUntil: 0,
      updatedAt: now
    };
  });

  if (blocked) {
    const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    throw new HttpsError('resource-exhausted', `Too many ${label} attempts. Retry in ${retrySeconds}s.`);
  }
}

function sanitizeIncomingGame(game) {
  if (!game || typeof game !== 'object') return null;
  try {
    const cloned = JSON.parse(JSON.stringify(game));
    const size = JSON.stringify(cloned).length;
    if (size > 1_000_000) {
      throw new HttpsError('invalid-argument', 'Game payload too large.');
    }
    return cloned;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('invalid-argument', 'Invalid game payload.');
  }
}

exports.createGameSession = onCall(CALLABLE_OPTS, async (request) => {
  const uid = ensureAuthed(request);

  const payload = request.data || {};
  const incomingGame = sanitizeIncomingGame(payload.game);
  const timestamp = nowTs();

  const gameId = randomGameId();
  const editCode = await reserveUniqueCode('editor', gameId, uid);
  const viewCode = await reserveUniqueCode('viewer', gameId, uid);

  const initialGame = incomingGame || {
    meta: {
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: uid,
      revision: 1
    },
    scorecard: {
      course: 'manito',
      handicapMode: 'rawHandicap',
      players: []
    },
    games: {
      vegas: { teams: null, opts: {} },
      banker: { state: null },
      skins: { mode: 'gross', buyIn: 10, carry: true, half: false },
      junk: { useNet: false, achievements: [] },
      hilo: { unitValue: 10 }
    }
  };

  initialGame.meta = {
    ...(initialGame.meta || {}),
    schemaVersion: Number(initialGame?.meta?.schemaVersion) || 1,
    createdAt: Number(initialGame?.meta?.createdAt) || timestamp,
    updatedAt: timestamp,
    updatedBy: uid,
    revision: Math.max(1, Number(initialGame?.meta?.revision) || 1)
  };

  const updates = {};
  updates[`games/${gameId}/state`] = initialGame;
  updates[`games/${gameId}/meta`] = {
    createdAt: timestamp,
    createdBy: uid,
    updatedAt: timestamp,
    updatedBy: uid,
    ownerUid: uid,
    lastSnapshotAt: 0,
    active: true
  };
  updates[`games/${gameId}/members/${uid}`] = {
    role: 'editor',
    joinedAt: timestamp
  };
  updates[`games/${gameId}/codes`] = {
    editCode,
    viewCode
  };

  await db.ref().update(updates);

  logger.info('Created game session', { gameId, uid });
  return {
    ok: true,
    gameId,
    role: 'editor',
    editCode,
    viewCode
  };
});

exports.redeemGameCode = onCall(CALLABLE_OPTS, async (request) => {
  const uid = ensureAuthed(request);
  const ipKey = normalizeIpKey(request.rawRequest?.ip);

  await enforceRateLimit(
    RATE_LIMITS.REDEEM_UID.path(uid),
    RATE_LIMITS.REDEEM_UID,
    'redeem'
  );
  if (ipKey) {
    await enforceRateLimit(
      RATE_LIMITS.REDEEM_IP.path(ipKey),
      RATE_LIMITS.REDEEM_IP,
      'redeem'
    );
  }

  const code = normalizeCode(request.data?.code);
  if (!code || code.length < 6) {
    throw new HttpsError('invalid-argument', 'Invalid code.');
  }

  const codeSnap = await db.ref(`codeMap/${code}`).get();
  const codeData = codeSnap.val();
  if (!codeData || !codeData.gameId || !codeData.role) {
    await enforceRateLimit(
      RATE_LIMITS.INVALID_UID.path(uid),
      RATE_LIMITS.INVALID_UID,
      'invalid-code'
    );
    if (ipKey) {
      await enforceRateLimit(
        RATE_LIMITS.INVALID_IP.path(ipKey),
        RATE_LIMITS.INVALID_IP,
        'invalid-code'
      );
    }
    throw new HttpsError('not-found', 'Code not found.');
  }

  const gameId = codeData.gameId;
  const role = codeData.role === 'editor' ? 'editor' : 'viewer';

  const gameExists = (await db.ref(`games/${gameId}/meta/createdAt`).get()).exists();
  if (!gameExists) {
    throw new HttpsError('not-found', 'Game not found.');
  }

  const memberRef = db.ref(`games/${gameId}/members/${uid}`);
  const currentMemberSnap = await memberRef.get();

  // Respect the redeemed code role exactly.
  // A view code must stay viewer-only even if this uid was previously editor.
  const targetRole = role;

  await memberRef.set({
    role: targetRole,
    joinedAt: currentMemberSnap.val()?.joinedAt || nowTs()
  });

  let editCode = '';
  let viewCode = '';
  const codesSnap = await db.ref(`games/${gameId}/codes`).get();
  const codes = codesSnap.val() || {};
  viewCode = normalizeCode(codes.viewCode);
  if (targetRole === 'editor') {
    editCode = normalizeCode(codes.editCode);
  }

  logger.info('Redeemed code', { gameId, uid, role: targetRole });
  return {
    ok: true,
    gameId,
    role: targetRole,
    editCode,
    viewCode
  };
});

exports.getGameCodes = onCall(CALLABLE_OPTS, async (request) => {
  const uid = ensureAuthed(request);
  const gameId = String(request.data?.gameId || '').trim();

  if (!gameId) {
    throw new HttpsError('invalid-argument', 'gameId is required.');
  }

  const roleSnap = await db.ref(`games/${gameId}/members/${uid}/role`).get();
  const role = roleSnap.val();
  if (role !== 'editor') {
    throw new HttpsError('permission-denied', 'Editor access required.');
  }

  const codesSnap = await db.ref(`games/${gameId}/codes`).get();
  const codes = codesSnap.val() || {};
  const viewCode = normalizeCode(codes.viewCode);
  const editCode = normalizeCode(codes.editCode);

  if (!viewCode) {
    throw new HttpsError('not-found', 'View code not found for this game.');
  }

  return {
    ok: true,
    gameId,
    editCode,
    viewCode
  };
});

exports.cleanupOldCloudData = onSchedule(
  {
    region: REGION,
    schedule: 'every 6 hours',
    timeZone: 'Etc/UTC'
  },
  async () => {
    const cutoffTs = nowTs() - RETENTION_MS;

    const gamesSnap = await db.ref('games').get();
    const games = gamesSnap.val() || {};

    const updates = {};
    let deletedGames = 0;
    let deletedSnapshots = 0;
    let deletedCodeMapEntries = 0;

    Object.entries(games).forEach(([gameId, gameData]) => {
      const meta = gameData?.meta || {};
      const gameUpdatedAt = Number(meta.updatedAt) || Number(meta.createdAt) || 0;

      if (gameUpdatedAt > 0 && gameUpdatedAt < cutoffTs) {
        updates[`games/${gameId}`] = null;
        deletedGames += 1;

        const editCode = gameData?.codes?.editCode;
        const viewCode = gameData?.codes?.viewCode;
        if (editCode) {
          updates[`codeMap/${String(editCode).toUpperCase()}`] = null;
          deletedCodeMapEntries += 1;
        }
        if (viewCode) {
          updates[`codeMap/${String(viewCode).toUpperCase()}`] = null;
          deletedCodeMapEntries += 1;
        }
        return;
      }

      const snapshots = gameData?.snapshots || {};
      Object.entries(snapshots).forEach(([snapshotId, snapshotData]) => {
        const snapshotCreatedAt = Number(snapshotData?.createdAt) || Number(snapshotId) || 0;
        if (snapshotCreatedAt > 0 && snapshotCreatedAt < cutoffTs) {
          updates[`games/${gameId}/snapshots/${snapshotId}`] = null;
          deletedSnapshots += 1;
        }
      });
    });

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
    }

    logger.info('cleanupOldCloudData complete', {
      retentionDays: DATA_RETENTION_DAYS,
      cutoffTs,
      deletedGames,
      deletedSnapshots,
      deletedCodeMapEntries
    });

    return {
      ok: true,
      retentionDays: DATA_RETENTION_DAYS,
      deletedGames,
      deletedSnapshots,
      deletedCodeMapEntries
    };
  }
);
