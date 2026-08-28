// The desktop lives behind this flow: server.js only serves it once /api/setup
// has handed out a session cookie. Without the Node backend the check falls
// back to a hash comparison, which is cosmetic — the real gate is the server.
const KEY_HASHES = [
  '01b2510065bec7ddc3759e22b3a821dfeee67ffee783ddf832c3c520dc1cfaaa',
  'c02098b59d704e21614f462778fc7f3440ef598b61b11e951b732f068e28376c',
  'd23c6491955aa882d27fffe4ba47c79b4f7f378cd8534421157941cdd236800c'
];
const KEY_GROUP_SIZE = 4;
const KEY_GROUPS = 3;
const KEY_MAX_LENGTH = KEY_GROUP_SIZE * KEY_GROUPS;

const $ = id => document.getElementById(id);
const screens = document.querySelectorAll('.screen');
const installMusic = $('install-audio');
const shutdownAudio = $('shutdown-audio');
const keyField = $('key-field');
const PANIC_URL = 'https://classroom.google.com/';
const PROFILE_KEY = 'idkProfile';
const SETUP_COMPLETE_KEY = 'idkSetupComplete';
const TIMEZONE_KEY = 'timezone';
const TIMEZONE_OFFSET_KEY = 'timezoneOffset';
const TIMEZONE_DST_KEY = 'timezoneDST';

let unlocked = false;

function show(id) {
  screens.forEach(screen => screen.classList.remove('show'));
  $(id).classList.add('show');
}

function savedPanicURL() {
  try {
    return JSON.parse(localStorage.getItem('panicURL')) || PANIC_URL;
  } catch (e) {
    return PANIC_URL;
  }
}

function beginShutdown() {
  $('click-overlay').style.display = 'none';
  $('help-ui').classList.add('hide');
  installMusic.pause();
  show('shutdown-screen');
  shutdownAudio.currentTime = 0;
  shutdownAudio.play().catch(() => {});

  setTimeout(() => {
    window.close();
    window.location.replace(savedPanicURL());
  }, 5200);
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function readProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY));
    return profile && typeof profile.name === 'string' && profile.passwordHash ? profile : null;
  } catch (e) {
    return null;
  }
}

function escapeXML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function fallbackAvatar(name) {
  const initials = String(name).trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#5986da"/><text x="64" y="76" fill="white" font-family="Arial,sans-serif" font-size="48" font-weight="700" text-anchor="middle">${escapeXML(initials)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function validAvatar(value) {
  return /^(?:https?:\/\/|data:image\/)/i.test(String(value).trim());
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('The profile picture could not be read.')));
    reader.readAsDataURL(file);
  });
}

function normalizeKey(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, KEY_MAX_LENGTH);
}

function formatKey(value) {
  const normalized = normalizeKey(value);
  return normalized.match(new RegExp(`.{1,${KEY_GROUP_SIZE}}`, 'g'))?.join('-') ?? '';
}

keyField.addEventListener('input', () => {
  keyField.value = formatKey(keyField.value);
});

// Returns true when the key is accepted. The server sets the session cookie;
// if it is not running (static hosting) we compare hashes locally instead.
async function submitKey(key) {
  const normalizedKey = normalizeKey(key);
  try {
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: normalizedKey })
    });
    if (res.status === 404) throw new Error('no backend');
    return res.ok;
  } catch (e) {
    return KEY_HASHES.includes(await sha256(normalizedKey));
  }
}

$('install-now-btn').addEventListener('click', () => {
  $('click-overlay').style.display = 'none';
  installMusic.play().catch(() => {});
  show('startup-screen');
  setTimeout(() => {
    show('setup1');
    $('help-ui').classList.remove('hide');
  }, 5000);
});

$('reg-next').addEventListener('click', () => {
  if ($('reg-no').checked) {
    alert('Closing Setup...');
    window.close();
    window.location.href = 'about:blank';
    return;
  }
  show('setup2');
});

  $('accounts-next').addEventListener('click', async () => {
    const name = $('account-name').value.trim();
    const password = $('account-password').value;
    const confirmation = $('account-password-confirm').value;
    const error = $('account-error-text');
    if (!name) { error.textContent = 'Enter a name for this account.'; return; }
    if (password.length < 4) { error.textContent = 'Use a password with at least 4 characters.'; return; }
    if (password !== confirmation) { error.textContent = 'The passwords do not match.'; return; }

    const button = $('accounts-next');
    button.disabled = true;
    try {
      const avatarURL = $('account-avatar').value.trim();
      const avatarFile = $('account-avatar-file').files[0];
      if (avatarFile && avatarFile.size > 2 * 1024 * 1024) throw new Error('Choose a profile picture smaller than 2 MB.');
      const avatar = avatarFile ? await readImageFile(avatarFile) : avatarURL;
      const avatarFallback = fallbackAvatar(name);
      const passwordSalt = randomHex();
      const profile = {
        version: 1,
        name,
        accounts: [name, ...[...document.querySelectorAll('.account-alt')].map(input => input.value.trim()).filter(Boolean)],
        passwordSalt,
        passwordHash: await sha256(passwordSalt + password),
        avatar: validAvatar(avatar) ? avatar : avatarFallback,
        avatarFallback,
        createdAt: Date.now()
      };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem(SETUP_COMPLETE_KEY, JSON.stringify(true));
      localStorage.setItem('chatName', JSON.stringify(name));
      try { sessionStorage.setItem('idkAccountUnlocked', 'true'); } catch (e) {}
      error.textContent = '';
      show('setup3');
    } catch (e) {
      error.textContent = e.message || 'This browser could not save the account. Check its storage permissions.';
    } finally {
      button.disabled = false;
    }
  });

$('key-next').addEventListener('click', async () => {
  const button = $('key-next');
  button.disabled = true;
  unlocked = await submitKey(keyField.value);
  button.disabled = false;

  if (!unlocked) {
    $('error-text').style.display = 'block';
    return;
  }
  $('error-text').style.display = 'none';
  show('timezone-screen');
});

function timezoneOffsetMinutes(zone, date = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find(item => item.type === 'timeZoneName')?.value || 'GMT';
    if (part === 'GMT' || part === 'UTC') return 0;
    const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0;
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch (e) {
    return 0;
  }
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `GMT${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function friendlyTimezone(zone) {
  if (zone === 'UTC') return 'Coordinated Universal Time';
  return zone.split('/').slice(-1)[0].replace(/_/g, ' ');
}

function populateTimezones() {
  const select = $('timezone-select');
  const known = new Set([...select.options].map(option => option.value));
  try {
    Intl.supportedValuesOf('timeZone').forEach(zone => {
      if (known.has(zone)) return;
      const option = document.createElement('option');
      option.value = zone;
      option.textContent = `(${formatOffset(timezoneOffsetMinutes(zone))}) ${friendlyTimezone(zone)}`;
      select.append(option);
    });
  } catch (e) {
    // The common zones above keep the selector usable in older browsers.
  }

  let preferred = 'America/Los_Angeles';
  try {
    const saved = localStorage.getItem(TIMEZONE_KEY);
    preferred = saved ? JSON.parse(saved) : Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {}
  if ([...select.options].some(option => option.value === preferred)) select.value = preferred;
  try {
    const savedDST = localStorage.getItem(TIMEZONE_DST_KEY);
    if (savedDST !== null) $('timezone-dst').checked = JSON.parse(savedDST);
  } catch (e) {}
  updateTimezoneOffset();
}

function updateTimezoneOffset() {
  $('timezone-offset').textContent = `Selected offset: ${formatOffset(timezoneOffsetMinutes($('timezone-select').value))}`;
}

$('timezone-select').addEventListener('change', updateTimezoneOffset);
$('timezone-next').addEventListener('click', () => {
  const zone = $('timezone-select').value;
  const offset = timezoneOffsetMinutes(zone);
  try {
    localStorage.setItem(TIMEZONE_KEY, JSON.stringify(zone));
    localStorage.setItem(TIMEZONE_OFFSET_KEY, JSON.stringify(offset));
    localStorage.setItem(TIMEZONE_DST_KEY, JSON.stringify($('timezone-dst').checked));
    $('timezone-summary').textContent = `${zone} (${formatOffset(offset)}), daylight saving ${$('timezone-dst').checked ? 'enabled' : 'disabled'}.`;
  } catch (e) {
    // Continue setup when browser storage is unavailable.
  }
  show('setup4');
});

populateTimezones();

$('finish-btn').addEventListener('click', () => {
  installMusic.pause();
  show('region-screen');
});

const TRANSLATIONS = {
  ES: {
    title: 'Seleccione Región y Estado',
    desc: 'Elija su ubicación para configurar el idioma.',
    region: 'Región:',
    state: 'Estado / Provincia:',
    next: 'Siguiente'
  },
  FR: {
    title: "Sélectionnez la région et l'état",
    desc: 'Choisissez votre emplacement pour définir la langue.',
    region: 'Région :',
    state: 'État / Province :',
    next: 'Suivant'
  },
  DE: {
    title: 'Region und Bundesland auswählen',
    desc: 'Wählen Sie Ihren Standort aus.',
    region: 'Region:',
    state: 'Bundesland:',
    next: 'Weiter'
  },
  JP: {
    title: '地域と州を選択してください',
    desc: '言語を設定する場所を選択します。',
    region: '地域:',
    state: '州 / 県:',
    next: '次へ'
  },
  US: {
    title: 'Select Region and State',
    desc: 'Choose your location to set the language.',
    region: 'Region:',
    state: 'State / Province:',
    next: 'Next'
  }
};

$('region-select').addEventListener('change', () => {
  const copy = TRANSLATIONS[$('region-select').value] || TRANSLATIONS.US;
  $('region-title').textContent = copy.title;
  $('region-desc').textContent = copy.desc;
  $('region-label').textContent = copy.region;
  $('state-label').textContent = copy.state;
  $('region-btn').textContent = copy.next;
});

$('region-btn').addEventListener('click', () => {
  $('help-ui').classList.add('hide');
  show('welcome-screen');
  $('welcome-audio').play().catch(() => {});
  setTimeout(() => window.location.replace('/desktop.html'), 4500);
});

if (new URLSearchParams(window.location.search).get('shutdown') === '1') {
  beginShutdown();
} else if (readProfile()) {
  const profile = readProfile();
  $('click-overlay').style.display = 'none';
  $('help-ui').classList.add('hide');
  $('welcome-screen').querySelector('.welcome-badge').textContent = 'Account restored';
  $('welcome-screen').querySelector('h2').textContent = `Welcome back, ${profile.name}`;
  $('welcome-screen').querySelector('p').textContent = 'Opening your saved desktop...';
  show('welcome-screen');
  setTimeout(() => window.location.replace('/desktop.html'), 900);
}

$('help-ui').addEventListener('click', () => {
  const help = {
    setup1: 'This is the registration screen. Choose whether you want to register now or later.',
    setup2: 'Please enter your name and alt accounts.',
    setup3: 'Enter the product key. Ask the owner for it.',
    setup4: "Your time zone is saved. Click 'Continue' to proceed to region settings.",
    'timezone-screen': 'Choose a global time zone and decide whether the clock should follow daylight saving changes.',
    'region-screen': 'Select your region and state to set your preferred language.'
  };
  const current = [...screens].find(screen => screen.classList.contains('show'));
    alert(`IDK 6.9 ASSISTANCE:\n\n${help[current?.id] ?? "Click 'start now' to begin."}`);
});
