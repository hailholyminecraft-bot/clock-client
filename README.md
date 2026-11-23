# Clock Client

A Lunar/Feather-style Minecraft client built on Fabric.

- `launcher/` - the desktop app (Electron): Clock logo, Microsoft sign-in, version picker, RAM and mod settings, Play button.
- The in-game mod (HUD modules, crosshair, media player, clock badge by names) is the next step. Build it and drop the `.jar` into `launcher/mods/`.

## Run the launcher

1. Install Node.js 20 or newer and a Java the game supports (recent versions need Java 21+, 26.x likely Java 25).
2. In `launcher/`:
   ```
   npm install
   npm start
   ```
3. Sign in with Microsoft, pick a version, press Play.

## What Play does

1. Installs the Fabric loader for the chosen version (only versions Fabric supports are listed).
2. Downloads and updates Fabric API plus FPS mods from Modrinth: Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast, ModernFix. Mods with no build for that version are skipped and listed in the game log.
3. Copies the Clock Client mod from `launcher/mods/`.
4. Starts the game with G1GC flags tuned to reduce stutter and the RAM you chose.

Everything lives in `.clockclient` inside your app data folder (Windows: `%APPDATA%\.clockclient`).

## Build an installer

```
npm run dist
```

Output goes to `launcher/dist/`.

## Module toggles

The Mods tab writes `config/clockclient.json` in the game folder. The in-game mod reads it:

```json
{ "modules": { "fps": true, "cps": true, "keystrokes": true, "coords": true, "ping": true,
  "armor": true, "effects": true, "clock": true, "crosshair": true, "zoom": true,
  "sprint": true, "media": true, "badge": true } }
```
