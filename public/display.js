const socket = io();

const THEMES = {
  bulletBlue: {
    '--bg': '#071225', '--panel': '#0f1c34', '--text': '#f2f7ff', '--muted': '#9bb6d9', '--accent': '#4cb5ff', '--danger': '#ff5f7a', '--success': '#58e98f'
  },
  darkGraphite: {
    '--bg': '#111214', '--panel': '#1d2026', '--text': '#f2f2f2', '--muted': '#a1a1a1', '--accent': '#66c2ff', '--danger': '#ff6b6b', '--success': '#57d68d'
  },
  greenFelt: {
    '--bg': '#062412', '--panel': '#0f3821', '--text': '#effff4', '--muted': '#9fc9ad', '--accent': '#7ef7b4', '--danger': '#ff7171', '--success': '#7ef7b4'
  },
  redDark: {
    '--bg': '#1f0a0e', '--panel': '#38141b', '--text': '#fff2f4', '--muted': '#d2a8b1', '--accent': '#ff7f9d', '--danger': '#ff6f6f', '--success': '#80f3b6'
  }
};

const BACKGROUNDS = {
  nebula: 'radial-gradient(circle at 20% 20%, #123868, #050a12 65%)',
  arena: 'linear-gradient(135deg, #2b2f36, #0d0f13)',
  velvet: 'linear-gradient(160deg, #341135, #0f0714)',
  carbon: 'linear-gradient(145deg, #1b1b1f, #0b0b0d)',
  emerald: 'linear-gradient(145deg, #0f3a2c, #04130e)'
};

const SOUND_PATTERNS = {
  beep3: [
    { f: 960, d: 220, g: 0.25 }, { pause: 120 },
    { f: 960, d: 220, g: 0.25 }, { pause: 120 },
    { f: 960, d: 220, g: 0.25 }
  ],
  gong: [{ f: 180, d: 3000, g: 0.28, type: 'triangle' }],
  bell: [{ f: 1200, d: 700, g: 0.27, type: 'triangle' }, { pause: 220 }, { f: 820, d: 700, g: 0.22, type: 'triangle' }],
  triangle: [{ f: 700, d: 400, g: 0.22, type: 'triangle' }, { pause: 220 }, { f: 1050, d: 400, g: 0.22, type: 'triangle' }],
  levelup: [{ f: 420, d: 250, g: 0.2 }, { pause: 90 }, { f: 620, d: 250, g: 0.2 }, { pause: 90 }, { f: 900, d: 700, g: 0.24 }]
};

const PAYOUT_FINAL9 = [25, 17, 13, 10, 9, 8, 7, 6, 5];
const PAYOUT_TOP18 = [23, 15, 11, 8.5, 7.5, 6.5, 5.5, 5, 4.5, 3, 2, 1.5, 1.5, 1.5, 1, 1, 1, 1];

const el = {
  bg: document.getElementById('displayBg'),
  overlay: document.getElementById('displayOverlay'),
  logo: document.getElementById('displayLogo'),
  enableSoundBtn: document.getElementById('enableSoundBtn'),
  payoutsPanel: document.getElementById('payoutsPanel'),
  payoutList: document.getElementById('payoutList'),
  tournamentName: document.getElementById('displayTournamentName'),
  subtitle: document.getElementById('displaySubtitle'),
  status: document.getElementById('displayStatus'),
  timer: document.getElementById('displayTimer'),
  currentLevelLabel: document.getElementById('currentLevelLabel'),
  currentBlinds: document.getElementById('currentBlinds'),
  currentAnte: document.getElementById('currentAnte'),
  nextLevelLabel: document.getElementById('nextLevelLabel'),
  nextBlinds: document.getElementById('nextBlinds'),
  nextAnte: document.getElementById('nextAnte'),
  breakBlock: document.getElementById('breakBlock'),
  breakCountdown: document.getElementById('breakCountdown'),
  currentBlock: document.getElementById('currentBlock'),
  playersLeft: document.getElementById('displayPlayersLeft'),
  playersTotal: document.getElementById('displayPlayersTotal'),
  reentries: document.getElementById('displayReentries'),
  chips: document.getElementById('displayChips'),
  avgStack: document.getElementById('displayAvgStack'),
  chipsLine: document.getElementById('chipsLine'),
  avgLine: document.getElementById('avgLine'),
  lateRegLine: document.getElementById('lateRegLine')
};

let currentState = null;
let audioContext = null;
let audioUnlocked = false;

function formatClock(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function lateRegText(state) {
  const end = Number(state.lateRegEndLevel) || 0;
  if (end <= 0) {
    return '';
  }
  if (state.currentLevelIndex < end) {
    return `Late reg: OPEN (ends at L${end})`;
  }
  return 'Late reg: CLOSED';
}

function chipsInPlay(state) {
  return ((state.playersTotal || 0) + (state.reentriesCount || 0) + (state.addonsCount || 0)) * (state.startingStack || 0);
}

function avgStack(state) {
  const left = state.playersLeft || 0;
  if (left <= 0) {
    return 0;
  }
  return Math.floor(chipsInPlay(state) / left);
}

function resolvePayoutPreset(state) {
  if (state.payoutPreset === 'final9') {
    return PAYOUT_FINAL9;
  }
  if (state.payoutPreset === 'top18') {
    return PAYOUT_TOP18;
  }
  return (state.playersTotal || 0) >= 50 ? PAYOUT_TOP18 : PAYOUT_FINAL9;
}

function renderPayouts(state) {
  if (!state.showPayouts) {
    el.payoutsPanel.classList.add('hidden');
    el.payoutList.innerHTML = '';
    return;
  }

  const percentages = resolvePayoutPreset(state);
  const pointsBank = ((state.playersTotal || 0) + (state.reentriesCount || 0)) * 100;
  const raw = percentages.map((percent) => Math.round(pointsBank * percent / 100));
  const sum = raw.reduce((acc, value) => acc + value, 0);
  if (raw.length > 0) {
    raw[0] += pointsBank - sum;
  }

  el.payoutList.innerHTML = '';
  raw.forEach((value, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${value} pts`;
    el.payoutList.appendChild(li);
  });

  el.payoutsPanel.classList.remove('hidden');
}

function applyTheme(themeName) {
  const theme = THEMES[themeName] || THEMES.bulletBlue;
  Object.entries(theme).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
}

function applyBackground(state) {
  if (state.backgroundPreset === 'custom' && state.backgroundCustom) {
    el.bg.style.backgroundImage = `url('${state.backgroundCustom}')`;
    return;
  }

  const bg = BACKGROUNDS[state.backgroundPreset] || BACKGROUNDS.nebula;
  el.bg.style.backgroundImage = bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient') ? bg : `url('${bg}')`;
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

function unlockAudio() {
  const ctx = ensureAudioContext();
  ctx.resume().then(() => {
    audioUnlocked = true;
    el.enableSoundBtn.textContent = 'Sound Enabled';
    el.enableSoundBtn.disabled = true;
  });
}

function playPattern(soundId, volume = 0.5) {
  if (!currentState?.soundsEnabled || !audioUnlocked) {
    return;
  }

  const pattern = SOUND_PATTERNS[soundId] || SOUND_PATTERNS.beep3;
  const ctx = ensureAudioContext();
  let offset = ctx.currentTime;

  pattern.forEach((step) => {
    if (step.pause) {
      offset += step.pause / 1000;
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = step.type || 'sine';
    osc.frequency.value = step.f;
    gain.gain.value = (step.g || 0.2) * Math.max(0, Math.min(1, volume));

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(offset);
    osc.stop(offset + (step.d / 1000));
    offset += step.d / 1000;
  });
}

el.enableSoundBtn.addEventListener('click', unlockAudio);

socket.on('sound:event', (payload = {}) => {
  playPattern(payload.soundId || 'beep3', typeof payload.volume === 'number' ? payload.volume : (currentState?.soundVolume || 0.5));
});

socket.on('state:update', (state) => {
  currentState = state;
  const current = state.levels[state.currentLevelIndex] || null;
  const next = state.levels[state.currentLevelIndex + 1] || null;
  const isBreak = Boolean(current && current.isBreak);

  applyTheme(state.theme);
  applyBackground(state);

  el.overlay.style.backgroundColor = `rgba(0,0,0,${(state.overlayDim || 0) / 100})`;
  el.logo.src = state.logoPath || '';
  el.logo.style.visibility = state.logoPath ? 'visible' : 'hidden';

  el.tournamentName.textContent = state.tournamentName || 'Poker Tournament';
  el.subtitle.textContent = state.subtitle || '';
  el.status.textContent = isBreak ? 'BREAK' : String(state.status || 'stopped').toUpperCase();
  el.timer.textContent = formatClock(state.remainingSec);

  el.currentBlock.classList.toggle('break-active', isBreak);
  if (isBreak) {
    el.currentLevelLabel.textContent = 'BREAK';
    el.currentBlinds.textContent = 'Blinds paused';
    el.currentAnte.textContent = '';
    el.breakBlock.classList.remove('hidden');
    el.breakCountdown.textContent = formatClock(state.remainingSec);
  } else {
    el.currentLevelLabel.textContent = `Level ${state.currentLevelIndex + 1}`;
    el.currentBlinds.textContent = current ? `SB/BB: ${current.sb} / ${current.bb}` : 'SB/BB: - / -';
    el.currentAnte.textContent = current ? `Ante: ${current.ante}` : 'Ante: -';
    el.breakBlock.classList.add('hidden');
  }

  if (next) {
    el.nextLevelLabel.textContent = next.isBreak ? 'BREAK' : `Level ${state.currentLevelIndex + 2}`;
    el.nextBlinds.textContent = next.isBreak ? 'Break incoming' : `SB/BB: ${next.sb} / ${next.bb}`;
    el.nextAnte.textContent = next.isBreak ? '' : `Ante: ${next.ante}`;
  } else {
    el.nextLevelLabel.textContent = 'No next level';
    el.nextBlinds.textContent = 'SB/BB: - / -';
    el.nextAnte.textContent = 'Ante: -';
  }

  el.playersLeft.textContent = state.playersLeft || 0;
  el.playersTotal.textContent = state.playersTotal || 0;
  el.reentries.textContent = state.reentriesCount || 0;
  el.chips.textContent = chipsInPlay(state);
  el.avgStack.textContent = avgStack(state);

  el.chipsLine.style.display = state.showChipsInPlay ? 'inline-flex' : 'none';
  el.avgLine.style.display = state.showAvgStack ? 'inline-flex' : 'none';

  const lateReg = lateRegText(state);
  if (lateReg) {
    el.lateRegLine.textContent = lateReg;
    el.lateRegLine.classList.remove('hidden');
  } else {
    el.lateRegLine.classList.add('hidden');
    el.lateRegLine.textContent = '';
  }

  renderPayouts(state);
});
