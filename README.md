# KUN Karbala - Maintenance & Housekeeping app

Service desk, procure-to-pay, stores and housekeeping control for the zaereen hotel (formats MH-01 to MH-24).
The app is hosted on GitHub Pages; all records are kept in the organisation's Firebase project and shared live with every user.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app |
| `config.js` | Connection to the Firebase project (paste your values here) |
| `firestore.rules` | Database rules to paste into the Firebase console |

## Set-up (about 20 minutes, once)

### A. Firebase - the cloud database and log-ins
1. Go to https://console.firebase.google.com, sign in with a Google account and click **Create a project** (name e.g. `kun-mh`; Google Analytics can be switched off).
2. **Build > Firestore Database > Create database**: choose **production mode** and the location nearest Karbala (a Middle East or Europe region). The location cannot be changed later.
3. In Firestore open the **Rules** tab, replace the text with the contents of `firestore.rules`, click **Publish**.
4. **Build > Authentication > Get started > Email/Password > Enable > Save.**
5. **Authentication > Settings > User actions**: untick **Enable create (sign-up)** so nobody can register themselves. Save.
6. **Authentication > Settings > Authorized domains > Add domain**: `YOUR-GITHUB-USERNAME.github.io`.
7. **Authentication > Users > Add user**: one account (email + password) for yourself and for each staff member.
8. **Project settings** (gear icon) **> General > Your apps > Web (`</>`)**: register an app (e.g. `KUN MH`, no hosting). Copy the values shown in `firebaseConfig`.

### B. GitHub - the web address
1. On https://github.com click **New repository**: name `kun-mh`, **Public**, **Create repository**.
2. Click **uploading an existing file**, drag in `index.html` and `config.js`, click **Commit changes**.
3. Open `config.js` in the repository, click the pencil (Edit), replace the `PASTE_...` values with the values from step A8, **Commit changes**.
4. **Settings > Pages**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**, **Save**.
5. After a minute or two the app is live at `https://YOUR-GITHUB-USERNAME.github.io/kun-mh/` - this is the URL for all users.

### C. First use
1. Open the URL and log in with your own account. Choose **Start with the October 2026 example data** (pilot) or **Start empty** (go-live). Whoever does this first becomes the app owner.
2. Choose **HOA** (or add yourself as an Admin user). In **Admin > Users** enter the real names of the users.
3. Give each staff member the URL with their email and password. At their first log-in they pick their user and click **Ask to be linked**; the Head of Accounts approves it in **Admin > Users**.
4. In **Settings (MH-01)** set the approval password, check the limits and lock them.

## Day to day
- A leaver: set the user to Active = N in **Admin > Users** and disable the account in Firebase Authentication.
- Forgotten password: the user clicks **Forgot password?** on the log-in page, or the Admin resets it in Firebase Authentication.
- Backup: **Admin > Data > Download backup** at least weekly.
- New version of the app: upload the new `index.html` to the repository (replace the file). `config.js` stays as it is.
- Costs: the Firebase free plan (Spark) is enough for a team of this size.
