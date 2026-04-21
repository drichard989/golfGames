# Firebase Deploy Steps (Cloud Sync)

## What was added

- Firebase project mapping: [.firebaserc](.firebaserc)
- Firebase deploy config: [firebase.json](firebase.json)
- Realtime Database rules: [database.rules.json](database.rules.json)
- Cloud Functions backend:
  - [functions/package.json](functions/package.json)
  - [functions/index.js](functions/index.js)

Callable functions implemented:
- `createGameSession`
- `redeemGameCode`

## 1) Install Firebase CLI (once)

```bash
npm install -g firebase-tools
firebase login
```

## 2) Install function dependencies

From repo root:

```bash
cd functions
npm install
cd ..
```

## 3) Deploy rules + functions

From repo root:

```bash
firebase deploy --only database,functions
```

## 4) Verify app config

Ensure [js/firebase-config.js](js/firebase-config.js) has correct values, especially:
- `databaseURL`
- `projectId`

## 5) Test flow in app

- Open Utilities panel
- Click **Create Live Session**
- Confirm edit/view codes appear
- Open another browser/device
- Join using view code (read-only)
- Join using edit code (editor)
- Edit scores and confirm real-time sync

## Notes

- API key in web config is expected to be public.
- Security is enforced by Auth + Realtime DB Rules + callable functions.
- Snapshots are written every ~10 minutes by editor clients at:
  - `games/{gameId}/snapshots/{timestamp}`
