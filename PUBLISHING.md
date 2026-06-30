# Publishing a New Release

## Prerequisites

### 1. GitHub Personal Access Token (PAT)
electron-builder needs write access to GitHub Releases to upload the installer and update metadata files.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Set a name like `forex-trading-ai-publish`
4. Select scope: **`repo`** (full control of private repositories)
5. Click **Generate token** and copy it immediately

Set the token as an environment variable before running the publish command:

```powershell
$env:GH_TOKEN = "ghp_your_token_here"
```

Or add it permanently to your user environment variables via:
**System → Advanced system settings → Environment Variables → User variables → New**
- Name: `GH_TOKEN`
- Value: `ghp_your_token_here`

### 2. GitHub Repository
The publish target is configured as:
- **Owner**: `davis-jemil`
- **Repo**: `forex-trading-ai-app`

Make sure this repository exists on GitHub before publishing. The first publish will create a new release draft.

---

## Releasing a New Version

### Step 1 — Bump the version
Edit `electron/package.json` and increment the version:

```json
"version": "1.0.1"
```

Use semantic versioning: `MAJOR.MINOR.PATCH`
- **PATCH** (`1.0.1`) — bug fixes, no new features
- **MINOR** (`1.1.0`) — new features, backwards compatible
- **MAJOR** (`2.0.0`) — breaking changes

### Step 2 — Rebuild the Python bundle (if Python code changed)
```powershell
cd "C:\Users\Administrator\Desktop\developer\forex trading ai"
pyinstaller forex_trading_ai.spec --clean -y
```

### Step 3 — Build and publish
```powershell
cd electron
$env:GH_TOKEN = "ghp_your_token_here"
npm run build -- --publish always
```

This single command:
1. Packages the Electron app and Python bundle into an NSIS installer
2. Generates `latest.yml` — the update metadata file that tells installed apps about the new version
3. Uploads both the installer (`Forex Trading AI Setup 1.0.1.exe`) and `latest.yml` to a new GitHub Release

### Step 4 — Verify on GitHub
Go to `https://github.com/davis-jemil/forex-trading-ai-app/releases` and confirm:
- A new release exists with the correct version tag
- The release contains `Forex Trading AI Setup 1.0.1.exe`, `Forex Trading AI Setup 1.0.1.exe.blockmap`, and `latest.yml`
- Publish the release (change from Draft to Published) if it was created as a draft

---

## How Users Receive Updates

Users who have the app installed will be notified automatically:

1. On every app launch, `autoUpdater.checkForUpdatesAndNotify()` runs silently
2. If a newer version is found in GitHub Releases, the update downloads in the background
3. When the download completes, a dialog appears:
   > **"Forex Trading AI v1.0.1 has been downloaded. Restart now to apply the update, or continue and restart later."**
4. Clicking **Restart Now** applies the update; **Later** defers until the next manual restart
5. Users can also trigger a manual check via the system tray: **right-click tray icon → Check for Updates**

Users do **not** need to manually download or reinstall — the updater handles everything.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ENOENT: GH_TOKEN` | Set the `GH_TOKEN` environment variable before running the publish command |
| Release created as draft | Go to GitHub Releases and click **Publish release** |
| `update-not-available` fires immediately | Ensure `latest.yml` in the release has the correct version |
| Users not seeing update | Check that the GitHub Release is Published (not Draft) and `latest.yml` is present |
| Build error: icon not found | Ensure `electron/assets/icon.ico` exists |
