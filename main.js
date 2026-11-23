const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const GAME_DIR = path.join(app.getPath('appData'), '.clockclient');
const SETTINGS_FILE = path.join(GAME_DIR, 'launcher.json');
const MOD_CONFIG = path.join(GAME_DIR, 'config', 'clockclient.json');
const UA = 'ClockClient/1.0 (launcher)';

// Mods the launcher keeps up to date from Modrinth (Fabric API is always needed).
const REQUIRED_MODS = ['fabric-api'];
const PERF_MODS = ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix'];

// G1GC flags tuned to reduce stutter.
const JVM_FLAGS = [
  '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC',
  '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1'
];

const DEFAULTS = {
  version: '',
  ram: 4096,
  javaPath: '',
  perfMods: true,
  token: null,
  modules: {
    fps: true, cps: true, keystrokes: true, coords: true, ping: true, armor: true,
    effects: true, clock: true, crosshair: true, zoom: true, sprint: true, media: true, badge: true
  }
};

let win = null;
let account = null; // msmc Minecraft token
let playing = false;
const authManager = new Auth('select_account');

// ---------- settings ----------
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULTS, ...saved, modules: { ...DEFAULTS.modules, ...(saved.modules || {}) } };
  } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  fs.mkdirSync(GAME_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  fs.mkdirSync(path.dirname(MOD_CONFIG), { recursive: true });
  // The in-game Clock Client mod reads this file to know which modules to enable.
  fs.writeFileSync(MOD_CONFIG, JSON.stringify({ modules: s.modules }, null, 2));
}
function saveToken(token) {
  const s = loadSettings();
  s.token = token && safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token).toString('base64') : null;
  saveSettings(s);
}
function loadToken() {
  const s = loadSettings();
  if (!s.token || !safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(Buffer.from(s.token, 'base64')); } catch { return null; }
}

// ---------- helpers ----------
const send = (data) => win && !win.isDestroyed() && win.webContents.send('status', data);
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
function javaMajor(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath || 'java', ['-version'], (err, _out, stderr) => {
      const m = /version "(\d+)(?:\.(\d+))?/.exec(String(stderr || ''));
      if (err || !m) return resolve(null);
      resolve(m[1] === '1' ? Number(m[2]) : Number(m[1]));
    });
  });
}

// ---------- account ----------
async function login() {
  const xbox = await authManager.launch('electron');
  account = await xbox.getMinecraft();
  saveToken(xbox.save());
  return { name: account.profile.name };
}
async function restore() {
  const token = loadToken();
  if (!token) return null;
  try {
    const xbox = await authManager.refresh(token);
    account = await xbox.getMinecraft();
    saveToken(xbox.save());
    return { name: account.profile.name };
  } catch { return null; }
}

// ---------- install ----------
async function installFabric(mc) {
  send({ phase: 'fabric', text: 'Setting up Fabric…', pct: 0 });
  const loaders = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}`);
  if (!loaders.length) throw new Error(`Fabric does not support Minecraft ${mc} yet.`);
  const loader = (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
  const profile = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`);
  const dir = path.join(GAME_DIR, 'versions', profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile));
  return profile.id;
}

async function syncMods(mc, s) {
  const dir = path.join(GAME_DIR, 'mods');
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, '.clock-managed.json');
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}

  const wanted = [...REQUIRED_MODS, ...(s.perfMods ? PERF_MODS : [])];
  for (const [slug, file] of Object.entries(manifest)) {
    if (!wanted.includes(slug)) { fs.rmSync(path.join(dir, file), { force: true }); delete manifest[slug]; }
  }

  const skipped = [];
  for (const [i, slug] of wanted.entries()) {
    send({ phase: 'mods', text: `Updating ${slug}…`, pct: i / wanted.length });
    try {
      const q = `game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent('["fabric"]')}`;
      const versions = await getJson(`https://api.modrinth.com/v2/project/${slug}/version?${q}`);
      const file = versions[0] && (versions[0].files.find((f) => f.primary) || versions[0].files[0]);
      if (!file) { skipped.push(slug); continue; }
      const dest = path.join(dir, file.filename);
      if (manifest[slug] && manifest[slug] !== file.filename) fs.rmSync(path.join(dir, manifest[slug]), { force: true });
      if (!fs.existsSync(dest)) {
        const res = await fetch(file.url, { headers: { 'User-Agent': UA } });
        const buf = Buffer.from(await res.arrayBuffer());
        if (crypto.createHash('sha512').update(buf).digest('hex') !== file.hashes.sha512) throw new Error('hash mismatch');
        fs.writeFileSync(dest, buf);
      }
      manifest[slug] = file.filename;
    } catch { skipped.push(slug); }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  // Copy the Clock Client in-game mod (put the built .jar in launcher/mods).
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'mods') : path.join(__dirname, 'mods');
  if (fs.existsSync(bundled)) {
    for (const f of fs.readdirSync(bundled).filter((n) => n.endsWith('.jar'))) {
      fs.copyFileSync(path.join(bundled, f), path.join(dir, f));
    }
  }
  return skipped;
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1040, height: 660, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#0e1024', title: 'Clock Client',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  fs.mkdirSync(GAME_DIR, { recursive: true });
  saveSettings(loadSettings());
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------
ipcMain.handle('state:get', async () => {
  const s = loadSettings();
  if (!account) await restore();
  const { token, ...safe } = s;
  return {
    settings: safe,
    account: account ? { name: account.profile.name } : null,
    maxRam: Math.floor(os.totalmem() / 1048576),
    java: await javaMajor(s.javaPath)
  };
});
ipcMain.handle('versions:list', async () => {
  const list = await getJson('https://meta.fabricmc.net/v2/versions/game');
  return list.filter((v) => v.stable).slice(0, 25).map((v) => v.version);
});
ipcMain.handle('settings:set', (_e, patch) => {
  const s = loadSettings();
  const next = { ...s, ...patch, modules: { ...s.modules, ...(patch.modules || {}) } };
  saveSettings(next);
  return true;
});
ipcMain.handle('auth:login', async () => {
  try { return await login(); } catch (e) { return { error: 'Sign-in was cancelled or failed. Try again.' }; }
});
ipcMain.handle('auth:logout', () => { account = null; saveToken(null); return true; });
ipcMain.handle('folder:open', () => shell.openPath(GAME_DIR));
ipcMain.handle('win:min', () => win.minimize());
ipcMain.handle('win:close', () => win.close());

ipcMain.handle('game:play', async (_e, mc) => {
  if (playing) return;
  playing = true;
  try {
    if (!account) throw new Error('Sign in with Microsoft before playing.');
    if (!mc) throw new Error('Pick a Minecraft version first.');
    const s = loadSettings();
    const customId = await installFabric(mc);
    const skipped = await syncMods(mc, s);
    if (skipped.length) send({ log: `No ${mc} build yet for: ${skipped.join(', ')}\n` });

    const client = new Client();
    client.on('progress', (p) => send({ phase: 'game', text: `Downloading game files (${p.type})…`, pct: p.total ? p.task / p.total : 0 }));
    client.on('debug', (d) => send({ log: `${d}\n` }));
    client.on('data', (d) => send({ log: `${d}\n` }));
    client.on('close', (code) => {
      playing = false;
      send({ phase: 'idle', text: code === 0 ? 'Game closed.' : `Game exited with code ${code}. Check the log.` });
    });

    const proc = await client.launch({
      authorization: account.mclc(),
      root: GAME_DIR,
      javaPath: s.javaPath || 'java',
      version: { number: mc, type: 'release', custom: customId },
      memory: { max: `${s.ram}M`, min: `${Math.min(s.ram, 2048)}M` },
      customArgs: JVM_FLAGS
    });
    if (!proc) throw new Error('The game did not start. Check the log for details.');
    send({ phase: 'running', text: 'Playing Minecraft', pct: 1 });
  } catch (e) {
    playing = false;
    send({ phase: 'error', text: e.message });
  }
});
