/*
  Firebase client configuration (safe to be public in web apps).
  Replace values below with your Firebase Web App config.

  Optional:
  - FIREBASE_FUNCTIONS_REGION: defaults to 'us-central1'
  - FIREBASE_USE_EMULATORS: true to use local emulators
*/

window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA5TjYHDp2clZM3TP-LRhB4FyPs7zYbuys',
  authDomain: 'golfgames-b3539.firebaseapp.com',
  databaseURL: 'https://golfgames-b3539-default-rtdb.firebaseio.com',
  projectId: 'golfgames-b3539',
  storageBucket: 'golfgames-b3539.firebasestorage.app',
  messagingSenderId: '318574955673',
  appId: '1:318574955673:web:99d7bdaccd50a5de1c7c08',
  measurementId: 'G-JJF40TMW4Q'
};

window.FIREBASE_FUNCTIONS_REGION = 'us-central1';
window.FIREBASE_USE_EMULATORS = false;

// Required for production Cloud Functions callable access when App Check is enforced.
// Create a reCAPTCHA v3 site key in Firebase App Check and set it here.
window.FIREBASE_APPCHECK_SITE_KEY = '6LeJxsQsAAAAADaVnKaFJs6qqZg_Q5RdCtgn0dyD';

// Optional for local debugging only:
// set to true OR to a debug token string from browser console/App Check logs.
window.FIREBASE_APPCHECK_DEBUG_TOKEN = false;
