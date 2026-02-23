const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const defaultLevels = [
  { durationSec: 1200, sb: 100, bb: 200, ante: 0, isBreak: false },
  { durationSec: 1200, sb: 100, bb: 300, ante: 0, isBreak: false },
  { durationSec: 1200, sb: 200, bb: 400, ante: 0, isBreak: false }
];

const baseState = {
  tournamentName: 'Poker Tournament',
  subtitle: 'Main Event',
  structurePreset: 'default',
  levels: defaultLevels,
  currentLevelIndex: 0,
  remainingSec: defaultLevels[0].durationSec,
  status: 'stopped',
  startTimestamp: null,
  pausedOffset: 0,
  playersTotal: 100,
  playersLeft: 100,
  reentriesCount: 0,
  addonsCount: 0,
  startingStack: 20000,
  addonStack: 10000,
  lateRegEndLevel: 0,
  payoutPreset: 'auto',
  showPayouts: false,
  showChipsInPlay: true,
  showAvgStack: true,
  alertSeconds: [60, 10],
  soundsEnabled: true,
  enableAlerts: true,
  enableLevelChangeSound: true,
  enableBreakSounds: true,
  soundVolume: 0.5,
  soundMap: {
    alert60: 'beep3',
    alert10: 'triangle',
    levelChange: 'levelup',
    breakStart: 'gong',
    breakEnd: 'bell'
  },
  backgroundPreset: 'nebula',
  backgroundCustom: '',
  overlayDim: 35,
  theme: 'bulletBlue',
  logoPath: ''
};

const state = { ...baseState };
let ticker = null;
let lastTickSecond = null;

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

function getCurrentLevel() {
  return state.levels[state.currentLevelIndex] || null;
}

function normalizeLevel(level) {
  return {
    durationSec: Math.max(60, Math.floor(Number(level.durationSec) || 600)),
    sb: Math.max(0, Math.floor(Number(level.sb) || 0)),
    bb: Math.max(0, Math.floor(Number(level.bb) || 0)),
    ante: Math.max(0, Math.floor(Number(level.ante) || 0)),
    isBreak: Boolean(level.isBreak)
  };
}

function normalizeAlertSeconds(alertSeconds) {
  if (!Array.isArray(alertSeconds)) {
    return [60, 10];
  }

  return [...new Set(alertSeconds
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((a, b) => b - a);
}

function applyStateDefaults() {
  if (!Array.isArray(state.levels) || state.levels.length === 0) {
    state.levels = [{ durationSec: 600, sb: 100, bb: 200, ante: 0, isBreak: false }];
  }

  state.levels = state.levels.map(normalizeLevel);
  state.alertSeconds = normalizeAlertSeconds(state.alertSeconds);
  state.playersTotal = Math.max(0, Math.floor(Number(state.playersTotal) || 0));
  state.playersLeft = Math.max(0, Math.floor(Number(state.playersLeft) || 0));
  state.reentriesCount = Math.max(0, Math.floor(Number(state.reentriesCount) || 0));
  state.addonsCount = Math.max(0, Math.floor(Number(state.addonsCount) || 0));
  state.startingStack = Math.max(0, Math.floor(Number(state.startingStack) || 0));
  state.addonStack = Math.max(0, Math.floor(Number(state.addonStack) || 0));
  state.overlayDim = Math.min(70, Math.max(0, Math.floor(Number(state.overlayDim) || 0)));
  state.soundVolume = Math.min(1, Math.max(0, Number(state.soundVolume) || 0));
  state.lateRegEndLevel = Math.max(0, Math.floor(Number(state.lateRegEndLevel) || 0));
  state.currentLevelIndex = Math.min(Math.max(0, state.currentLevelIndex), state.levels.length - 1);

  if (state.playersLeft > state.playersTotal) {
    state.playersLeft = state.playersTotal;
  }

  if (!getCurrentLevel()) {
    state.currentLevelIndex = 0;
    state.remainingSec = 0;
  }
}

function calcRunningRemainingSec(nowMs = Date.now()) {
  const level = getCurrentLevel();
  if (!level) {
    return 0;
  }
  const elapsedSec = Math.floor(((nowMs - state.startTimestamp) / 1000) + state.pausedOffset);
  return Math.max(0, level.durationSec - elapsedSec);
}

function emitState() {
  applyStateDefaults();
  io.emit('state:update', state);
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  lastTickSecond = null;
}

function emitSoundEvent(type) {
  if (!state.soundsEnabled) {
    return;
  }
  io.emit('sound:event', {
    type,
    soundId: state.soundMap[type] || 'beep3',
    volume: state.soundVolume
  });
}

function goToLevel(index, mode = 'manual') {
  if (index < 0) {
    index = 0;
  }

  if (index >= state.levels.length) {
    state.status = 'stopped';
    state.currentLevelIndex = state.levels.length - 1;
    const last = getCurrentLevel();
    state.remainingSec = last ? last.durationSec : 0;
    state.startTimestamp = null;
    state.pausedOffset = 0;
    stopTicker();
    emitState();
    return false;
  }

  const prev = getCurrentLevel();
  const wasBreak = Boolean(prev && prev.isBreak);

  state.currentLevelIndex = index;
  const current = getCurrentLevel();
  state.remainingSec = current ? current.durationSec : 0;

  if (state.status === 'running') {
    state.startTimestamp = Date.now();
    state.pausedOffset = 0;
    lastTickSecond = null;
  } else {
    state.startTimestamp = null;
    state.pausedOffset = 0;
  }

  if (mode !== 'reset') {
    if (state.enableLevelChangeSound) {
      emitSoundEvent('levelChange');
    }

    const isBreak = Boolean(current && current.isBreak);
    if (state.enableBreakSounds && !wasBreak && isBreak) {
      emitSoundEvent('breakStart');
    }
    if (state.enableBreakSounds && wasBreak && !isBreak) {
      emitSoundEvent('breakEnd');
    }
  }

  emitState();
  return true;
}

function tick() {
  if (state.status !== 'running') {
    return;
  }

  const remaining = calcRunningRemainingSec();
  state.remainingSec = remaining;

  if (remaining !== lastTickSecond) {
    if (state.enableAlerts && state.alertSeconds.includes(remaining)) {
      if (remaining === 60) {
        emitSoundEvent('alert60');
      } else {
        emitSoundEvent('alert10');
      }
    }
    lastTickSecond = remaining;
  }

  if (remaining <= 0) {
    goToLevel(state.currentLevelIndex + 1, 'auto');
    return;
  }

  emitState();
}

function startTicker() {
  if (!ticker) {
    ticker = setInterval(tick, 1000);
  }
}

function updateStateFromPayload(payload = {}) {
  if (typeof payload.tournamentName === 'string') {
    state.tournamentName = payload.tournamentName.trim() || baseState.tournamentName;
  }
  if (typeof payload.subtitle === 'string') {
    state.subtitle = payload.subtitle.trim();
  }
  if (typeof payload.structurePreset === 'string') {
    state.structurePreset = payload.structurePreset;
  }
  if (Array.isArray(payload.levels)) {
    state.levels = payload.levels.map(normalizeLevel);
  }

  [
    'playersTotal',
    'playersLeft',
    'reentriesCount',
    'addonsCount',
    'startingStack',
    'addonStack',
    'overlayDim',
    'lateRegEndLevel',
    'soundVolume'
  ].forEach((key) => {
    if (typeof payload[key] === 'number') {
      state[key] = payload[key];
    }
  });

  ['showChipsInPlay', 'showAvgStack', 'soundsEnabled', 'showPayouts', 'enableAlerts', 'enableLevelChangeSound', 'enableBreakSounds'].forEach((key) => {
    if (typeof payload[key] === 'boolean') {
      state[key] = payload[key];
    }
  });

  ['backgroundPreset', 'backgroundCustom', 'theme', 'logoPath', 'payoutPreset'].forEach((key) => {
    if (typeof payload[key] === 'string') {
      state[key] = payload[key];
    }
  });

  if (Array.isArray(payload.alertSeconds)) {
    state.alertSeconds = normalizeAlertSeconds(payload.alertSeconds);
  }

  if (payload.soundMap && typeof payload.soundMap === 'object') {
    state.soundMap = { ...state.soundMap, ...payload.soundMap };
  }

  applyStateDefaults();
}

function saveDataUrlToFile(dataUrl, prefix) {
  const match = String(dataUrl).match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) {
    return '';
  }

  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };
  const mime = match[1].toLowerCase();
  const ext = extMap[mime] || 'png';
  const fileName = `${prefix}-${Date.now()}.${ext}`;
  const relativePath = `/uploads/${fileName}`;
  const fullPath = path.join(uploadsDir, fileName);

  fs.writeFileSync(fullPath, Buffer.from(match[3], 'base64'));
  return relativePath;
}

io.on('connection', (socket) => {
  socket.emit('state:update', state);

  socket.on('admin:updateState', (payload = {}) => {
    updateStateFromPayload(payload);
    emitState();
  });

  socket.on('admin:initState', (payload = {}) => {
    updateStateFromPayload(payload);
    state.currentLevelIndex = 0;
    state.status = 'stopped';
    state.startTimestamp = null;
    state.pausedOffset = 0;
    state.remainingSec = getCurrentLevel() ? getCurrentLevel().durationSec : 0;
    stopTicker();
    emitState();
  });

  socket.on('admin:start', () => {
    if (!getCurrentLevel()) {
      return;
    }

    state.status = 'running';
    state.startTimestamp = Date.now();
    state.pausedOffset = 0;
    lastTickSecond = null;
    startTicker();
    emitState();
  });

  socket.on('admin-pause', () => {
    if (state.status !== 'running') {
      return;
    }

    state.remainingSec = calcRunningRemainingSec();
    const level = getCurrentLevel();
    state.pausedOffset = level ? level.durationSec - state.remainingSec : 0;
    state.startTimestamp = null;
    state.status = 'paused';
    emitState();
  });

  socket.on('admin-resume', () => {
    if (state.status !== 'paused') {
      return;
    }

    state.status = 'running';
    state.startTimestamp = Date.now();
    lastTickSecond = null;
    startTicker();
    emitState();
  });

  socket.on('admin-reset', () => {
    state.status = 'stopped';
    state.currentLevelIndex = 0;
    state.startTimestamp = null;
    state.pausedOffset = 0;
    state.remainingSec = getCurrentLevel() ? getCurrentLevel().durationSec : 0;
    stopTicker();
    emitState();
  });

  socket.on('admin:nextLevel', () => {
    goToLevel(state.currentLevelIndex + 1, 'manual');
  });

  socket.on('admin:prevLevel', () => {
    goToLevel(state.currentLevelIndex - 1, 'manual');
  });

  socket.on('sound:event', (payload = {}) => {
    io.emit('sound:event', {
      type: payload.type || 'levelChange',
      soundId: payload.soundId || state.soundMap.levelChange,
      volume: typeof payload.volume === 'number' ? payload.volume : state.soundVolume
    });
  });

  socket.on('admin:uploadAsset', (payload = {}) => {
    const { type, dataUrl } = payload;
    if (!dataUrl || !type) {
      return;
    }

    if (type === 'logo') {
      const relativePath = saveDataUrlToFile(dataUrl, 'logo');
      if (relativePath) {
        state.logoPath = relativePath;
        emitState();
      }
      return;
    }

    if (type === 'background') {
      const relativePath = saveDataUrlToFile(dataUrl, 'bg');
      if (relativePath) {
        state.backgroundCustom = relativePath;
        state.backgroundPreset = 'custom';
        emitState();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Poker clock running on http://localhost:${PORT}`);
});
