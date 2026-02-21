const socket = io();

const PRESETS = {
  turbo: {
    label: 'Turbo 10 min / 20k',
    startingStack: 20000,
    alertSeconds: [60, 10],
    levels: [
      { durationMin: 10, sb: 100, bb: 200, ante: 0, isBreak: false },
      { durationMin: 10, sb: 200, bb: 400, ante: 0, isBreak: false },
      { durationMin: 10, sb: 300, bb: 600, ante: 50, isBreak: false },
      { durationMin: 5, sb: 0, bb: 0, ante: 0, isBreak: true },
      { durationMin: 10, sb: 400, bb: 800, ante: 100, isBreak: false }
    ]
  },
  standard: {
    label: 'Standard 15 min / 30k',
    startingStack: 30000,
    alertSeconds: [60, 10],
    levels: [
      { durationMin: 15, sb: 100, bb: 200, ante: 0, isBreak: false },
      { durationMin: 15, sb: 200, bb: 400, ante: 0, isBreak: false },
      { durationMin: 15, sb: 300, bb: 600, ante: 100, isBreak: false },
      { durationMin: 5, sb: 0, bb: 0, ante: 0, isBreak: true },
      { durationMin: 15, sb: 400, bb: 800, ante: 100, isBreak: false }
    ]
  },
  deepstack: {
    label: 'Deepstack 20 min / 50k',
    startingStack: 50000,
    alertSeconds: [120, 60, 10],
    levels: [
      { durationMin: 20, sb: 100, bb: 100, ante: 0, isBreak: false },
      { durationMin: 20, sb: 100, bb: 200, ante: 0, isBreak: false },
      { durationMin: 20, sb: 200, bb: 300, ante: 0, isBreak: false },
      { durationMin: 5, sb: 0, bb: 0, ante: 0, isBreak: true },
      { durationMin: 20, sb: 200, bb: 400, ante: 50, isBreak: false }
    ]
  }
};

const ui = {
  tournamentName: document.getElementById('tournamentName'),
  playersTotal: document.getElementById('playersTotal'),
  playersLeft: document.getElementById('playersLeft'),
  startingStack: document.getElementById('startingStack'),
  alertTimes: document.getElementById('alertTimes'),
  presetSelect: document.getElementById('presetSelect'),
  levelsTableBody: document.querySelector('#levelsTable tbody'),
  statusText: document.getElementById('statusText'),
  currentLevelText: document.getElementById('currentLevelText'),
  remainingText: document.getElementById('remainingText')
};

let localState = null;

function formatClock(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function parseAlertSeconds(text) {
  const values = String(text)
    .split(',')
    .map((value) => Math.floor(Number(value.trim())))
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(values)].sort((a, b) => b - a);
}

function toDurationMin(durationSec) {
  return Math.max(1, Math.floor((Number(durationSec) || 60) / 60));
}

function toDurationSec(durationMin) {
  return Math.max(1, Number(durationMin) || 1) * 60;
}

function renderLevels(levels) {
  ui.levelsTableBody.innerHTML = '';

  levels.forEach((level, index) => {
    const row = document.createElement('tr');

    row.innerHTML = `
      <td>${index + 1}</td>
      <td><input type="number" min="1" value="${toDurationMin(level.durationSec)}" data-field="durationMin" /></td>
      <td><input type="number" min="0" value="${level.sb}" data-field="sb" /></td>
      <td><input type="number" min="0" value="${level.bb}" data-field="bb" /></td>
      <td><input type="number" min="0" value="${level.ante}" data-field="ante" /></td>
      <td><input type="checkbox" ${level.isBreak ? 'checked' : ''} data-field="isBreak" /></td>
      <td>
        <button data-action="save">Save</button>
        <button data-action="delete" class="danger">Delete</button>
      </td>
    `;

    row.querySelector('[data-action="save"]').addEventListener('click', () => {
      const payload = {};
      row.querySelectorAll('input').forEach((input) => {
        const key = input.dataset.field;
        payload[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      });

      socket.emit('admin-updateLevel', {
        index,
        level: {
          durationSec: toDurationSec(payload.durationMin),
          sb: payload.sb,
          bb: payload.bb,
          ante: payload.ante,
          isBreak: payload.isBreak
        }
      });
    });

    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      if (!localState || localState.levels.length <= 1) {
        return;
      }
      localState.levels.splice(index, 1);
      emitInitState(localState.levels);
    });

    ui.levelsTableBody.appendChild(row);
  });
}

function emitInitState(levels) {
  const alertSeconds = parseAlertSeconds(ui.alertTimes.value);
  socket.emit('admin:initState', {
    tournamentName: ui.tournamentName.value,
    levels,
    playersTotal: Number(ui.playersTotal.value),
    playersLeft: Number(ui.playersLeft.value),
    startingStack: Number(ui.startingStack.value),
    alertSeconds
  });
}

function hydratePresetOptions() {
  Object.entries(PRESETS).forEach(([key, preset]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    ui.presetSelect.appendChild(option);
  });
}

function applyPreset(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) {
    return;
  }

  ui.startingStack.value = preset.startingStack;
  ui.alertTimes.value = preset.alertSeconds.join(',');

  const levels = preset.levels.map((level) => ({
    durationSec: level.durationMin * 60,
    sb: level.sb,
    bb: level.bb,
    ante: level.ante,
    isBreak: level.isBreak
  }));

  emitInitState(levels);
}

socket.on('state:update', (state) => {
  localState = structuredClone(state);
  ui.tournamentName.value = state.tournamentName;
  ui.playersTotal.value = state.playersTotal;
  ui.playersLeft.value = state.playersLeft;
  ui.startingStack.value = state.startingStack || 0;
  ui.alertTimes.value = (state.alertSeconds || []).join(',');
  ui.statusText.textContent = state.status;
  ui.currentLevelText.textContent = state.currentLevelIndex + 1;
  ui.remainingText.textContent = formatClock(state.remainingSec);
  renderLevels(state.levels);
});

document.getElementById('saveSetup').addEventListener('click', () => {
  if (!localState) {
    return;
  }
  emitInitState(localState.levels);
});

document.getElementById('addLevelBtn').addEventListener('click', () => {
  if (!localState) {
    return;
  }

  localState.levels.push({
    durationSec: 600,
    sb: 500,
    bb: 1000,
    ante: 100,
    isBreak: false
  });

  emitInitState(localState.levels);
});

document.getElementById('applyPresetBtn').addEventListener('click', () => {
  applyPreset(ui.presetSelect.value);
});

document.getElementById('startBtn').addEventListener('click', () => {
  socket.emit('admin:start');
});

document.getElementById('pauseBtn').addEventListener('click', () => {
  socket.emit('admin-pause');
});

document.getElementById('resumeBtn').addEventListener('click', () => {
  socket.emit('admin-resume');
});

document.getElementById('resetBtn').addEventListener('click', () => {
  socket.emit('admin-reset');
});

document.getElementById('nextLevelBtn').addEventListener('click', () => {
  socket.emit('admin:nextLevel');
});

document.getElementById('prevLevelBtn').addEventListener('click', () => {
  socket.emit('admin:prevLevel');
});

function sendPlayersUpdate() {
  socket.emit('admin-setPlayers', {
    playersTotal: Number(ui.playersTotal.value),
    playersLeft: Number(ui.playersLeft.value)
  });
}

ui.playersTotal.addEventListener('change', sendPlayersUpdate);
ui.playersLeft.addEventListener('change', sendPlayersUpdate);

hydratePresetOptions();

