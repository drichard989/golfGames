const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.database();

const REGION = 'us-central1';
const EDIT_CODE_LENGTH = 8;
const VIEW_CODE_LENGTH = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_ATTEMPTS = 10;

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

function sanitizeIncomingGame(game) {
  if (!game || typeof game !== 'object') return null;
  return game;
}

exports.createGameSession = onCall({ region: REGION }, async (request) => {
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
      handicapMode: 'playOffLow',
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

exports.redeemGameCode = onCall({ region: REGION }, async (request) => {
  const uid = ensureAuthed(request);

  const code = normalizeCode(request.data?.code);
  if (!code || code.length < 6) {
    throw new HttpsError('invalid-argument', 'Invalid code.');
  }

  const codeSnap = await db.ref(`codeMap/${code}`).get();
  const codeData = codeSnap.val();
  if (!codeData || !codeData.gameId || !codeData.role) {
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
  const currentRole = currentMemberSnap.val()?.role;

  let targetRole = role;
  if (currentRole === 'editor') {
    targetRole = 'editor';
  }

  await memberRef.set({
    role: targetRole,
    joinedAt: currentMemberSnap.val()?.joinedAt || nowTs()
  });

  logger.info('Redeemed code', { gameId, uid, role: targetRole });
  return {
    ok: true,
    gameId,
    role: targetRole
  };
});
