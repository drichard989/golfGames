# PWA Setup Complete! 🎉

Your Golf Scorecard is now a Progressive Web App with **automatic silent updates**.

## How It Works

1. **User opens the app** → Service worker checks for updates
2. **If new version exists** → Downloads in background
3. **When ready** → Page auto-reloads with new version
4. **User doesn't notice** → Seamless experience

## Deployment Workflow

### Every time you want to deploy an update:

1. **Make your code changes** to `index.html`, `index.js`, CSS, etc.

2. **Update the version** in `sw.js`:
   ```javascript
   const CACHE_VERSION = 'v1.0.1'; // Change this number!
   ```

3. **Commit and push** to GitHub:
   ```bash
   git add .
   git commit -m "Update version 1.0.1"
   git push
   ```

4. **Users get the update automatically** next time they open the app

## Installation

### On Mobile (iOS/Android):
1. Open the site in Safari (iOS) or Chrome (Android)
2. Tap Share button
3. Select "Add to Home Screen"
4. App icon appears on home screen

### On Desktop (Chrome/Edge):
1. Look for install icon in address bar
2. Click to install
3. App opens in its own window

## Icons Needed

You need to create two icon images and place them in `/images/`:
- `icon-192.png` (192x192 pixels)
- `icon-512.png` (512x512 pixels)

Use a golf-themed icon (⛳ 🏌️ or your logo)

## Testing Updates

1. Make a visible change (e.g., change a button text)
2. Update CACHE_VERSION in `sw.js`
3. Deploy
4. Open the app
5. Wait 10-15 seconds
6. App should reload automatically with changes

## Browser Console

Check the console to see update logs:
- `[PWA] Service Worker registered`
- `[SW] Installing version: v1.0.1`
- `[SW] Activating version: v1.0.1`
- `[PWA] New version detected, reloading...`

## Files Added

- ✅ `/sw.js` - Service worker (handles caching & updates)
- ✅ `/manifest.json` - App metadata (name, icons, colors)
- ✅ Updated `/index.html` - Added manifest link & SW registration

## Current Version

**v1.0.0** - Initial PWA setup

---

**Remember:** Just increment `CACHE_VERSION` in `sw.js` every deployment!
