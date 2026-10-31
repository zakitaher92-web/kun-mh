// KUN Maintenance & Housekeeping - connection to the cloud database (Firebase).
// Paste the values from Firebase console > Project settings > General > Your apps > Web app > "firebaseConfig".
// These values are not secret: access is protected by the Firestore rules and the log-in accounts.
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};
