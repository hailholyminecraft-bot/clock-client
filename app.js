const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Module ids must match the ones the in-game Clock Client mod reads from config/clockclient.json.
const MODULES = [
  { group: 'HUD', items: [
    ['fps', 'FPS display', 'Frames per second on screen'],
    ['cps', 'CPS counter', 'Clicks per second'],
    ['keystrokes', 'Keystrokes', 'WASD, space and mouse buttons'],
    ['coords', 'Coordinates', 'Your position and facing'],
    ['ping', 'Ping', 'Server latency'],
    ['armor', 'Armor status', 'Durability of what you wear'],
    ['effects', 'Potion effects', 'Active effects and timers'],
    ['clock', 'Real-time clock', 'Your local time']
  ]},
  { group: 'Gameplay', items: [
    ['crosshair', 'Custom crosshair', 'Shape, size and color'],
    ['zoom', 'Zoom', 'Hold a key to zoom in'],
    ['sprint', 'Toggle sprint', 'Sprint without holding the key'],
    ['media', 'Media player', 'See and control what you are listening to']
  ]},
  { group: 'Cosmetics', items: [
    ['badge', 'Clock badge', 'A Minecraft clock next to your name']
  ]}
];

let state = null;
let busy = false;

// ---------- window + tabs ----------
$('#min').onclick = () => clock.minimize();
$('#close').onclick = () => clock.close();
$$('.tab').forEach((btn) => btn.onclick = () => {
  $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
});

// ---------- live clock ----------
function tick() {
  const d = new Date();
  const s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
  $('#h-hour').style.transform = `rotate(${h * 30}deg)`;
  $('#h-min').style.transform = `rotate(${m * 6}deg)`;
  $('#h-sec').style.transform = `rotate(${s * 6}deg)`;
  $('#digital').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------- account ----------
function renderAccount() {
  const a = state.account;
  $('#acct-name').textContent = a ? a.name : 'Not signed in';
  $('#acct-btn').textContent = a ? 'Sign out' : 'Sign in with Microsoft';
}
async function signIn() {
  const r = await clock.login();
  if (r.error) { setStatus(r.error, 'error'); return false; }
  state.account = r; renderAccount(); return true;
}
$('#acct-btn').onclick = async () => {
  if (state.account) { await clock.logout(); state.account = null; renderAccount(); }
  else await signIn();
};

// ---------- mods ----------
function renderMods() {
  const root = $('#mods');
  root.textContent = '';
  for (const g of MODULES) {
    const box = document.createElement('div');
    box.className = 'group';
    const h = document.createElement('h2'); h.textContent = g.group; box.append(h);
    for (const [id, name, desc] of g.items) {
      const row = document.createElement('div'); row.className = 'mod';
      const text = document.createElement('div');
      const b = document.createElement('b'); b.textContent = name;
      const sm = document.createElement('small'); sm.textContent = desc;
      text.append(b, sm);
      const sw = document.createElement('label'); sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!state.settings.modules[id];
      input.setAttribute('aria-label', name);
      input.onchange = () => {
        state.settings.modules[id] = input.checked;
        clock.set({ modules: { [id]: input.checked } });
      };
      sw.append(input, document.createElement('span'));
      row.append(text, sw); box.append(row);
    }
    root.append(box);
  }
}

// ---------- settings ----------
function renderSettings() {
  const ram = $('#ram');
  ram.max = Math.max(2048, Math.min(16384, Math.floor(state.maxRam * 0.75 / 512) * 512));
  ram.value = Math.min(state.settings.ram, ram.max);
  const showRam = () => { $('#ram-out').textContent = `${(ram.value / 1024).toFixed(ram.value % 1024 ? 1 : 0)} GB`; };
  showRam();
  ram.oninput = showRam;
  ram.onchange = () => clock.set({ ram: Number(ram.value) });

  $('#perf').checked = state.settings.perfMods;
  $('#perf').onchange = (e) => clock.set({ perfMods: e.target.checked });

  $('#java').value = state.settings.javaPath;
  $('#java').onchange = (e) => clock.set({ javaPath: e.target.value.trim() });
  $('#java-hint').textContent = state.java
    ? `Java ${state.java} found. Recent Minecraft versions need Java 21 or newer.`
    : 'No Java found. Install a recent Java or set its path here.';

  $('#folder').onclick = () => clock.openFolder();
}

// ---------- play ----------
function setStatus(text, kind) {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${kind || ''}`;
}
function setBusy(on) {
  busy = on;
  $('#play').disabled = on;
  $('#version').disabled = on;
}
$('#version').onchange = (e) => clock.set({ version: e.target.value });

$('#play').onclick = async () => {
  if (busy) return;
  if (!state.account && !(await signIn())) return;
  setBusy(true);
  $('#log').textContent = '';
  setStatus('Starting…');
  clock.play($('#version').value);
};

clock.onStatus((d) => {
  if (d.log) {
    const log = $('#log');
    log.textContent += d.log;
    log.scrollTop = log.scrollHeight;
  }
  if (!d.phase) return;
  if (typeof d.pct === 'number') $('#progress').style.width = `${Math.round(d.pct * 100)}%`;
  if (d.phase === 'error') { setStatus(d.text, 'error'); setBusy(false); $('#progress').style.width = '0'; }
  else if (d.phase === 'idle') { setStatus(d.text); setBusy(false); $('#progress').style.width = '0'; }
  else if (d.phase === 'running') { setStatus(d.text, 'ok'); }
  else setStatus(d.text);
});

// ---------- init ----------
(async function init() {
  state = await clock.state();
  renderAccount(); renderMods(); renderSettings();
  tick(); setInterval(tick, 1000);

  const select = $('#version');
  try {
    const versions = await clock.versions();
    for (const v of versions) select.append(new Option(v, v));
    select.value = versions.includes(state.settings.version) ? state.settings.version : versions[0];
    clock.set({ version: select.value });
  } catch {
    select.append(new Option('Could not load versions', ''));
    setStatus('Could not reach the version list. Check your internet connection.', 'error');
    $('#play').disabled = true;
  }
})();
