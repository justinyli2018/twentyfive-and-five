# Releasing 25 & 5

There are two ways to get the app to people. You can do either or both.

| Route | Cost | Effort | Users see |
|---|---|---|---|
| **A. Direct download** (GitHub Releases) | Free unsigned; signing costs extra | Low | A download page with installers |
| **B. App stores** | Microsoft: free · Apple: $99/yr · Linux stores: free | Medium–high (reviews, store listings) | "Get" button in a store, automatic updates |

Fees were checked in November 2026. They change, so confirm before you sign up.

---

## Before your first release (do once)

1. **Choose the permanent app ID.** In `package.json`, `build.appId` is currently the placeholder `com.twentyfiveandfive.timer`. Stores tie your app to this ID forever. Use a domain you control, reversed (for example `com.yourname.twentyfiveandfive`), or `io.github.<your-github-username>.twentyfiveandfive`. Also update it in `build/entitlements.mas.plist`.
2. **Set your name.** `author.name` in `package.json` is `"Your Name"`. It appears in installers and the Linux package.
3. **Pick a license** (for example MIT) and add a `LICENSE` file. Stores and Linux repositories ask for one.
4. **Put the project on GitHub.**
   ```sh
   git init && git add . && git commit -m "25 & 5 v1.0.0"
   # create an empty repo on github.com, then:
   git remote add origin https://github.com/<you>/twentyfive-and-five.git
   git push -u origin main
   ```
5. **Optional: upgrade Node to 22+.** Then you can move to the newest Electron: `npm install --save-dev electron@latest`. The build machines in GitHub Actions already use Node 22.

---

## A. Direct download via GitHub Releases

### Every release

```sh
npm version 1.0.1          # bumps package.json and creates tag v1.0.1
git push --follow-tags     # GitHub Actions builds all installers
```

Then open **GitHub → Releases**, check the draft the workflow created, and click **Publish**.

The workflow (`.github/workflows/release.yml`) produces:

| OS | Files |
|---|---|
| Windows | `.exe` installer (x64 + ARM) |
| macOS | `.dmg` and `.zip` (Intel + Apple Silicon in one) |
| Linux | `.AppImage` and `.deb` |

You can build the Linux files locally with `npm run dist:linux`. Windows and macOS builds need those operating systems, which is why the workflow runs on GitHub's machines.

### Code signing (strongly recommended)

Unsigned apps work, but users see scary warnings:

- **macOS:** unsigned apps are blocked. Users must right-click → Open, or allow them in System Settings → Privacy & Security.
- **Windows:** SmartScreen shows "Windows protected your PC" and users must click *More info → Run anyway*.

**macOS signing + notarization** (requires the Apple Developer Program, $99/yr):
1. Enroll at developer.apple.com/programs.
2. In Xcode or the developer portal, create a **Developer ID Application** certificate and export it as a `.p12` with a password.
3. Create an **app-specific password** at appleid.apple.com.
4. Add these GitHub repository secrets (Settings → Secrets and variables → Actions):
   - `MAC_CERT_P12_BASE64`: output of `base64 -i cert.p12`
   - `MAC_CERT_PASSWORD`
   - `APPLE_ID`: your Apple account email
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`: shown on your developer account page

The workflow signs and notarizes automatically when these secrets exist.

**Windows signing**, either of:
- **Azure Artifact Signing** (formerly Trusted Signing): a monthly subscription, and the cheapest option for most individuals. Check eligibility for your country. It needs a different electron-builder setup (`win.azureSignOptions`) instead of the certificate secrets.
- **A code-signing certificate** from a certificate authority (usually a yearly fee). Export it as `.pfx` and add the secrets `WIN_CERT_PFX_BASE64` and `WIN_CERT_PASSWORD`.
- Or skip it: apps in the Microsoft Store are signed by Microsoft (see below).

---

## B. App stores

### Microsoft Store (Windows): free for individuals

The Store signs your app for you, which also removes the SmartScreen warning for Store installs.

1. Register as an individual developer at developer.microsoft.com/microsoft-store/register. It's free, but if a legacy sign-up page asks for a fee, use the link from the Store marketing page instead.
2. In **Partner Center**, create a new app and reserve the name (for example "25 & 5 Study Timer").
3. Partner Center → your app → **Product identity** shows three values. Add them to `build.appx` in `package.json`:
   ```json
   "appx": {
     "identityName": "12345YourName.25and5",
     "publisher": "CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
     "publisherDisplayName": "Your Name",
     "applicationId": "TwentyFiveAndFive",
     "displayName": "25 & 5",
     "backgroundColor": "transparent"
   }
   ```
4. On a Windows PC: `npm ci && npm run dist:msstore` produces an `.appx` in `dist/`.
5. In Partner Center, create a submission: upload the `.appx`, add screenshots, a description, an age rating and a privacy policy URL. A short policy is enough. Say that the app stores only local settings, and that the Auto and Neutral appearances read a low-resolution view of the screen around the overlay to measure brightness, in memory only, never saved or transmitted. Then submit. Review usually takes a few days.

### Mac App Store: $99/yr (same membership as signing)

The Mac App Store requires the app to run in Apple's **sandbox**. Before submitting, test that the always-on-top panel, global shortcuts, Auto / Neutral appearance (Screen Recording permission) and Neutral's system blur still work in a sandboxed build. In App Review notes, explain that screen access is only used to pick light or dark mode. If Apple's review or the sandbox blocks a feature, distribute the Mac version as a signed download (route A) instead.

1. In App Store Connect, create the app with your bundle ID (the `appId`).
2. In the developer portal, create **Apple Distribution** and **Mac Installer Distribution** certificates and install them on your Mac.
3. Create a **Mac App Store provisioning profile** for the bundle ID and save it as `build/embedded.provisionprofile`.
4. Replace `TEAMID` in `build/entitlements.mas.plist`.
5. On a Mac: `npm ci && npm run dist:mas` produces a `.pkg`.
6. Upload it with the **Transporter** app, then fill in the listing (screenshots, description, privacy details) and submit for review.

### Linux stores: free

- **Snap Store** (Ubuntu's built-in store): add `"snap"` to `build.linux.target`, build on Linux with `snapcraft` installed, then `snapcraft upload --release=stable dist/*.snap` after registering the name at snapcraft.io.
- **Flathub** (used by most other distributions): you submit a manifest to Flathub's GitHub, and their build servers repackage your release. It's more work, but it reaches the most Linux users. See docs.flathub.org.
- The `.AppImage` and `.deb` from GitHub Releases work without any store. Users on Ubuntu 22.04+ need `sudo apt install libfuse2t64` (or `libfuse2`) to run AppImages; the `.deb` works without it.

---

## Release checklist

- [ ] Version bumped (`npm version x.y.z`)
- [ ] App tested on each OS you ship to: always-on-top, shortcuts, transparency, tray, Auto switching, Neutral glass blur
- [ ] Draft release reviewed and published
- [ ] Store submissions updated with the new build (if using stores)
