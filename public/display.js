const socket = io();

const el = {
  tournamentName: document.getElementById('displayTournamentName'),
  status: document.getElementById('displayStatus'),
  timer: document.getElementById('displayTimer'),
  currentLevelLabel: document.getElementById('currentLevelLabel'),
  currentBlinds: document.getElementById('currentBlinds'),
  currentAnte: document.getElementById('currentAnte'),
  nextLevelLabel: document.getElementById('nextLevelLabel'),
  nextBlinds: document.getElementById('nextBlinds'),
  nextAnte: document.getElementById('nextAnte'),
  playersLeft: document.getElementById('displayPlayersLeft'),
  playersTotal: document.getElementById('displayPlayersTotal'),
  avgStack: document.getElementById('displayAvgStack'),
  fullscreenBtn: document.getElementById('fullscreenBtn')
};

let prevLevelIndex = null;
let prevIsBreak = null;

function formatClock(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function beep(frequency = 880, duration = 180) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  gain.gain.value = 0.08;

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start();
  setTimeout(() => {
    oscillator.stop();
    context.close();
  }, duration);
}

function statusText(state, currentLevel) {
  if (state.status === 'paused') {
    return 'Paused';
  }

  if (currentLevel && currentLevel.isBreak) {
    return 'Break';
  }

  if (state.status === 'running') {
    return 'Playing';
  }

  return 'Stopped';
}

function calculateAvgStack(state) {
  if (!state.playersLeft || state.playersLeft <= 0) {
    return 0;
  }
  return Math.floor((state.playersTotal * state.startingStack) / state.playersLeft);
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
    return;
  }

  await document.exitFullscreen();
}

socket.on('sound:alert', () => {
  beep(1000, 160);
});

socket.on('state:update', (state) => {
  const currentLevel = state.levels[state.currentLevelIndex] || null;
  const nextLevel = state.levels[state.currentLevelIndex + 1] || null;

  if (prevLevelIndex !== null && state.currentLevelIndex !== prevLevelIndex) {
    beep(1200, 240);
  }

  const currentIsBreak = Boolean(currentLevel && currentLevel.isBreak);
  if (prevIsBreak !== null && currentIsBreak !== prevIsBreak) {
    beep(currentIsBreak ? 660 : 960, 300);
  }

  prevLevelIndex = state.currentLevelIndex;
  prevIsBreak = currentIsBreak;

  el.tournamentName.textContent = state.tournamentName;
  el.status.textContent = statusText(state, currentLevel);
  el.timer.textContent = formatClock(state.remainingSec);

  if (currentLevel) {
    el.currentLevelLabel.textContent = `Level ${state.currentLevelIndex + 1}${currentLevel.isBreak ? ' (Break)' : ''}`;
    el.currentBlinds.textContent = `SB/BB: ${currentLevel.sb} / ${currentLevel.bb}`;
    el.currentAnte.textContent = `Ante: ${currentLevel.ante}`;
  }

  if (nextLevel) {
    el.nextLevelLabel.textContent = `Level ${state.currentLevelIndex + 2}${nextLevel.isBreak ? ' (Break)' : ''}`;
    el.nextBlinds.textContent = `SB/BB: ${nextLevel.sb} / ${nextLevel.bb}`;
    el.nextAnte.textContent = `Ante: ${nextLevel.ante}`;
  } else {
    el.nextLevelLabel.textContent = 'No next level';
    el.nextBlinds.textContent = 'SB/BB: - / -';
    el.nextAnte.textContent = 'Ante: -';
  }

  el.playersLeft.textContent = state.playersLeft;
  el.playersTotal.textContent = state.playersTotal;
  el.avgStack.textContent = calculateAvgStack(state);
});

el.fullscreenBtn.addEventListener('click', () => {
  toggleFullscreen();
});

