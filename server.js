const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const defaultLevels = [
  { durationSec: 600, sb: 100, bb: 200, ante: 0, isBreak: false },
  { durationSec: 600, sb: 200, bb: 400, ante: 0, isBreak: false },
  { durationSec: 300, sb: 0, bb: 0, ante: 0, isBreak: true },
  { durationSec: 600, sb: 300, bb: 600, ante: 50, isBreak: false }
];

const state = {
  tournamentName: 'Poker Tournament',
  levels: defaultLevels,
  currentLevelIndex: 0,
  remainingSec: defaultLevels[0].durationSec,
  status: 'stopped',
  playersTotal: 0,
  playersLeft: 0,
  alertSeconds: [60, 10],
  startingStack: 20000
};

let ticker = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getCurrentLevel() {
  return state.levels[state.currentLevelIndex] || null;
}

function normalizeLevel(level) {
  return {
    durationSec: Math.max(60, Number(level.durationSec) || 600),
    sb: Math.max(0, Number(level.sb) || 0),
    bb: Math.max(0, Number(level.bb) || 0),
    ante: Math.max(0, Number(level.ante) || 0),
    isBreak: Boolean(level.isBreak)
  };
}

function normalizeAlertSeconds(alertSeconds) {
  if (!Array.isArray(alertSeconds)) {
    return [60, 10];
  }

  const normalized = [...new Set(alertSeconds
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((a, b) => b - a);

  return normalized;
}

function applyLevelDefaults() {
  if (!Array.isArray(state.levels) || state.levels.length === 0) {
    state.levels = [{ durationSec: 600, sb: 100, bb: 200, ante: 0, isBreak: false }];
  }

  state.levels = state.levels.map(normalizeLevel);
  state.alertSeconds = normalizeAlertSeconds(state.alertSeconds);
  state.startingStack = Math.max(0, Math.floor(Number(state.startingStack) || 0));

  if (state.currentLevelIndex >= state.levels.length) {
    state.currentLevelIndex = state.levels.length - 1;
  }

  if (state.currentLevelIndex < 0) {
    state.currentLevelIndex = 0;
  }

  const level = getCurrentLevel();
  if (!level) {
    state.currentLevelIndex = 0;
    state.remainingSec = 0;
    return;
  }

  if (state.remainingSec <= 0 || state.remainingSec > level.durationSec) {
    state.remainingSec = level.durationSec;
  }

  if (state.playersLeft > state.playersTotal) {
    state.playersLeft = state.playersTotal;
  }
}

function emitState() {
  applyLevelDefaults();
  io.emit('state:update', state);
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function moveToLevel(nextIndex, shouldStopWhenDone = true) {
  if (nextIndex >= state.levels.length) {
    state.currentLevelIndex = state.levels.length - 1;
    const current = getCurrentLevel();
    state.remainingSec = current ? current.durationSec : 0;
    if (shouldStopWhenDone) {
      state.status = 'stopped';
      stopTicker();
    }
    emitState();
    return false;
  }

  if (nextIndex < 0) {
    nextIndex = 0;
  }

  state.currentLevelIndex = nextIndex;
  const current = getCurrentLevel();
  state.remainingSec = current ? current.durationSec : 0;
  emitState();
  return true;
}

function startTicker() {
  if (ticker) {
    return;
  }

  ticker = setInterval(() => {
    if (state.status !== 'running') {
      return;
    }

    state.remainingSec -= 1;

    if (state.alertSeconds.includes(state.remainingSec)) {
      io.emit('sound:alert', {
        remainingSec: state.remainingSec,
        currentLevelIndex: state.currentLevelIndex
      });
    }

    if (state.remainingSec <= 0) {
      moveToLevel(state.currentLevelIndex + 1, true);
      return;
    }

    emitState();
  }, 1000);
}

io.on('connection', (socket) => {
  socket.emit('state:update', state);

  socket.on('admin:initState', (payload = {}) => {
    if (typeof payload.tournamentName === 'string') {
      state.tournamentName = payload.tournamentName.trim() || 'Poker Tournament';
    }

    if (Array.isArray(payload.levels)) {
      state.levels = payload.levels.map(normalizeLevel);
    }

    if (typeof payload.playersTotal === 'number') {
      state.playersTotal = Math.max(0, payload.playersTotal);
    }

    if (typeof payload.playersLeft === 'number') {
      state.playersLeft = Math.max(0, payload.playersLeft);
    }

    if (Array.isArray(payload.alertSeconds)) {
      state.alertSeconds = normalizeAlertSeconds(payload.alertSeconds);
    }

    if (typeof payload.startingStack === 'number') {
      state.startingStack = Math.max(0, Math.floor(payload.startingStack));
    }

    state.currentLevelIndex = 0;
    state.status = 'stopped';
    const first = getCurrentLevel();
    state.remainingSec = first ? first.durationSec : 0;
    stopTicker();
    emitState();
  });

  socket.on('admin:start', () => {
    const level = getCurrentLevel();
    if (!level) {
      return;
    }

    if (state.status === 'stopped') {
      state.remainingSec = level.durationSec;
    }

    state.status = 'running';
    startTicker();
    emitState();
  });

  socket.on('admin-pause', () => {
    if (state.status === 'running') {
      state.status = 'paused';
      emitState();
    }
  });

  socket.on('admin-resume', () => {
    if (state.status === 'paused') {
      state.status = 'running';
      startTicker();
      emitState();
    }
  });

  socket.on('admin-reset', () => {
    state.currentLevelIndex = 0;
    state.status = 'stopped';
    const first = getCurrentLevel();
    state.remainingSec = first ? first.durationSec : 0;
    stopTicker();
    emitState();
  });

  socket.on('admin:nextLevel', () => {
    const moved = moveToLevel(state.currentLevelIndex + 1, false);
    if (!moved) {
      return;
    }

    if (state.status === 'running') {
      startTicker();
    }
  });

  socket.on('admin:prevLevel', () => {
    moveToLevel(state.currentLevelIndex - 1, false);
  });

  socket.on('admin-setPlayers', (payload = {}) => {
    if (typeof payload.playersTotal === 'number') {
      state.playersTotal = Math.max(0, payload.playersTotal);
    }

    if (typeof payload.playersLeft === 'number') {
      state.playersLeft = Math.max(0, payload.playersLeft);
    }

    if (state.playersLeft > state.playersTotal) {
      state.playersLeft = state.playersTotal;
    }

    emitState();
  });

  socket.on('admin-updateLevel', (payload = {}) => {
    const { index, level } = payload;

    if (!Number.isInteger(index) || index < 0 || index >= state.levels.length || !level) {
      return;
    }

    state.levels[index] = normalizeLevel(level);
    const current = getCurrentLevel();
    if (current && index === state.currentLevelIndex && state.remainingSec > current.durationSec) {
      state.remainingSec = current.durationSec;
    }

    emitState();
  });
});

server.listen(PORT, () => {
  console.log(`Poker clock running on http://localhost:${PORT}`);
});

