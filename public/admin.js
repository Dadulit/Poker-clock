const socket = io();

const STORAGE_KEY = 'pokerClockAdminState';

const SOUND_PRESETS = {
  beep3: 'Beep x3',
  gong: 'Gong',
  bell: 'Bell',
  triangle: 'Triangle',
  levelup: 'LevelUp'
};

const BACKGROUND_PRESETS = {
  nebula: 'Nebula',
  arena: 'Arena Lights',
  velvet: 'Velvet',
  carbon: 'Carbon',
  emerald: 'Emerald',
  custom: 'Custom Upload'
};

const THEMES = {
  bulletBlue: 'Bullet Blue',
  darkGraphite: 'Dark Graphite',
  greenFelt: 'Green Felt',
  redDark: 'Red Dark'
};

const ui = {
  tournamentName: document.getElementById('tournamentName'),
  subtitle: document.getElementById('subtitle'),
  lateRegEndLevel: document.getElementById('lateRegEndLevel'),
  startingStack: document.getElementById('startingStack'),
  addonStack: document.getElementById('addonStack'),
  playersTotal: document.getElementById('playersTotal'),
  playersLeft: document.getElementById('playersLeft'),
  reentriesCount: document.getElementById('reentriesCount'),
  addonsCount: document.getElementById('addonsCount'),
  alertTimes: document.getElementById('alertTimes'),
  showChipsInPlay: document.getElementById('showChipsInPlay'),
  showAvgStack: document.getElementById('showAvgStack'),
  levelsTableBody: document.querySelector('#levelsTable tbody'),
  levelsCards: document.getElementById('levelsCards'),
  statusText: document.getElementById('statusText'),
  currentLevelText: document.getElementById('currentLevelText'),
  remainingText: document.getElementById('remainingText'),
  soundsEnabled: document.getElementById('soundsEnabled'),
  backgroundPreset: document.getElementById('backgroundPreset'),
  overlayDim: document.getElementById('overlayDim'),
  backgroundUpload: document.getElementById('backgroundUpload'),
  backgroundPreview: document.getElementById('backgroundPreview'),
  themeSelect: document.getElementById('themeSelect'),
  logoUpload: document.getElementById('logoUpload'),
  logoPreview: document.getElementById('logoPreview')
};

let localState = null;

function formatClock(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function parseAlertSeconds(text) {
  return [...new Set(String(text)
    .split(',')
    .map((value) => Math.floor(Number(value.trim())))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((a, b) => b - a);
}

function toDurationMin(durationSec) {
  return Math.max(1, Math.floor((Number(durationSec) || 60) / 60));
}

function toDurationSec(durationMin) {
  return Math.max(1, Number(durationMin) || 1) * 60;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function initSelects() {
  Object.entries(SOUND_PRESETS).forEach(([value, label]) => {
    ['alert60', 'alert10', 'levelChange', 'breakStart', 'breakEnd'].forEach((eventName) => {
      const select = document.getElementById(`sound-${eventName}`);
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  });

  Object.entries(BACKGROUND_PRESETS).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    ui.backgroundPreset.appendChild(option);
  });

  Object.entries(THEMES).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    ui.themeSelect.appendChild(option);
  });
}

function moveLevel(index, dir) {
  const target = index + dir;
  if (!localState || target < 0 || target >= localState.levels.length) {
    return;
  }
  [localState.levels[target], localState.levels[index]] = [localState.levels[index], localState.levels[target]];
  emitInitState(localState.levels);
}

function deleteLevel(index) {
  if (!localState || localState.levels.length <= 1) {
    return;
  }
  localState.levels.splice(index, 1);
  emitInitState(localState.levels);
}

function createCommonActions(container, index) {
  const up = container.querySelector('[data-action="up"]');
  const down = container.querySelector('[data-action="down"]');
  const del = container.querySelector('[data-action="delete"]');

  up?.addEventListener('click', () => moveLevel(index, -1));
  down?.addEventListener('click', () => moveLevel(index, 1));
  del?.addEventListener('click', () => deleteLevel(index));
}

function renderLevels(levels) {
  ui.levelsTableBody.innerHTML = '';
  ui.levelsCards.innerHTML = '';

  levels.forEach((level, index) => {
    const isBreak = Boolean(level.isBreak);

    const row = document.createElement('tr');
    row.className = isBreak ? 'break-row' : '';
    row.innerHTML = `
      <td>${isBreak ? 'BREAK' : index + 1}</td>
      <td><input type="number" min="1" value="${toDurationMin(level.durationSec)}" data-field="durationMin" /></td>
      <td><input type="number" min="0" value="${level.sb}" data-field="sb" ${isBreak ? 'disabled' : ''} /></td>
      <td><input type="number" min="0" value="${level.bb}" data-field="bb" ${isBreak ? 'disabled' : ''} /></td>
      <td><input type="number" min="0" value="${level.ante}" data-field="ante" ${isBreak ? 'disabled' : ''} /></td>
      <td><input type="checkbox" ${isBreak ? 'checked' : ''} disabled /></td>
      <td class="level-actions">
        <button data-action="up">↑</button>
        <button data-action="down">↓</button>
        <button data-action="delete" class="danger">Delete</button>
      </td>
    `;

    createCommonActions(row, index);

    row.querySelectorAll('input[data-field]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.dataset.field === 'durationMin') {
          localState.levels[index].durationSec = toDurationSec(input.value);
        }
        if (!isBreak && ['sb', 'bb', 'ante'].includes(input.dataset.field)) {
          localState.levels[index][input.dataset.field] = Math.max(0, Number(input.value) || 0);
        }
        emitInitState(localState.levels);
      });
    });

    ui.levelsTableBody.appendChild(row);

    const card = document.createElement('div');
    card.className = `level-card-mobile ${isBreak ? 'break-row' : ''}`;
    card.innerHTML = `
      <h3>${isBreak ? `BREAK ${index + 1}` : `Level ${index + 1}`}</h3>
      <label>Duration (min)<input type="number" min="1" value="${toDurationMin(level.durationSec)}" data-card-field="durationMin" /></label>
      <label>SB<input type="number" min="0" value="${level.sb}" data-card-field="sb" ${isBreak ? 'disabled' : ''} /></label>
      <label>BB<input type="number" min="0" value="${level.bb}" data-card-field="bb" ${isBreak ? 'disabled' : ''} /></label>
      <label>Ante<input type="number" min="0" value="${level.ante}" data-card-field="ante" ${isBreak ? 'disabled' : ''} /></label>
      <div class="level-actions">
        <button data-action="up">↑</button>
        <button data-action="down">↓</button>
        <button data-action="delete" class="danger">Delete</button>
      </div>
    `;

    createCommonActions(card, index);

    card.querySelectorAll('input[data-card-field]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.dataset.cardField === 'durationMin') {
          localState.levels[index].durationSec = toDurationSec(input.value);
        }
        if (!isBreak && ['sb', 'bb', 'ante'].includes(input.dataset.cardField)) {
          localState.levels[index][input.dataset.cardField] = Math.max(0, Number(input.value) || 0);
        }
        emitInitState(localState.levels);
      });
    });

    ui.levelsCards.appendChild(card);
  });
}

function collectState() {
  return {
    tournamentName: ui.tournamentName.value,
    subtitle: ui.subtitle.value,
    lateRegEndLevel: Math.max(0, Number(ui.lateRegEndLevel.value) || 0),
    levels: localState ? localState.levels : [],
    playersTotal: Number(ui.playersTotal.value),
    playersLeft: Number(ui.playersLeft.value),
    reentriesCount: Number(ui.reentriesCount.value),
    addonsCount: Number(ui.addonsCount.value),
    startingStack: Number(ui.startingStack.value),
    addonStack: Number(ui.addonStack.value),
    showChipsInPlay: ui.showChipsInPlay.checked,
    showAvgStack: ui.showAvgStack.checked,
    alertSeconds: parseAlertSeconds(ui.alertTimes.value),
    soundsEnabled: ui.soundsEnabled.checked,
    soundMap: {
      alert60: document.getElementById('sound-alert60').value,
      alert10: document.getElementById('sound-alert10').value,
      levelChange: document.getElementById('sound-levelChange').value,
      breakStart: document.getElementById('sound-breakStart').value,
      breakEnd: document.getElementById('sound-breakEnd').value
    },
    backgroundPreset: ui.backgroundPreset.value,
    overlayDim: Number(ui.overlayDim.value),
    theme: ui.themeSelect.value,
    backgroundCustom: localState ? localState.backgroundCustom : '',
    logoPath: localState ? localState.logoPath : ''
  };
}

function persistLocal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function emitUpdateState() {
  const payload = collectState();
  persistLocal(payload);
  socket.emit('admin:updateState', payload);
}

function emitInitState(levels) {
  const payload = collectState();
  payload.levels = levels;
  persistLocal(payload);
  socket.emit('admin:initState', payload);
}

function previewImage(target, src) {
  target.src = src || '';
  target.style.visibility = src ? 'visible' : 'hidden';
}

socket.on('state:update', (state) => {
  localState = structuredClone(state);

  ui.tournamentName.value = state.tournamentName || '';
  ui.subtitle.value = state.subtitle || '';
  ui.lateRegEndLevel.value = state.lateRegEndLevel || 0;
  ui.startingStack.value = state.startingStack || 0;
  ui.addonStack.value = state.addonStack || 0;
  ui.playersTotal.value = state.playersTotal;
  ui.playersLeft.value = state.playersLeft;
  ui.reentriesCount.value = state.reentriesCount || 0;
  ui.addonsCount.value = state.addonsCount || 0;
  ui.alertTimes.value = (state.alertSeconds || []).join(',');
  ui.showChipsInPlay.checked = Boolean(state.showChipsInPlay);
  ui.showAvgStack.checked = Boolean(state.showAvgStack);
  ui.soundsEnabled.checked = Boolean(state.soundsEnabled);

  ['alert60', 'alert10', 'levelChange', 'breakStart', 'breakEnd'].forEach((eventName) => {
    document.getElementById(`sound-${eventName}`).value = state.soundMap?.[eventName] || 'beep3';
  });

  ui.backgroundPreset.value = state.backgroundPreset || 'nebula';
  ui.overlayDim.value = state.overlayDim || 0;
  ui.themeSelect.value = state.theme || 'bulletBlue';

  previewImage(ui.backgroundPreview, state.backgroundCustom || '');
  previewImage(ui.logoPreview, state.logoPath || '');

  ui.statusText.textContent = state.status;
  ui.currentLevelText.textContent = state.currentLevelIndex + 1;
  ui.remainingText.textContent = formatClock(state.remainingSec);

  renderLevels(state.levels);
});

function setupInputListeners() {
  [
    ui.tournamentName,
    ui.subtitle,
    ui.lateRegEndLevel,
    ui.startingStack,
    ui.addonStack,
    ui.playersTotal,
    ui.playersLeft,
    ui.reentriesCount,
    ui.addonsCount,
    ui.alertTimes,
    ui.showChipsInPlay,
    ui.showAvgStack,
    ui.soundsEnabled,
    ui.backgroundPreset,
    ui.overlayDim,
    ui.themeSelect,
    document.getElementById('sound-alert60'),
    document.getElementById('sound-alert10'),
    document.getElementById('sound-levelChange'),
    document.getElementById('sound-breakStart'),
    document.getElementById('sound-breakEnd')
  ].forEach((input) => {
    input.addEventListener('change', emitUpdateState);
  });
}

async function uploadAsset(file, type) {
  if (!file) {
    return;
  }
  const dataUrl = await readAsDataURL(file);
  socket.emit('admin:uploadAsset', { type, dataUrl });
}

ui.backgroundUpload.addEventListener('change', async (event) => {
  await uploadAsset(event.target.files[0], 'background');
});

ui.logoUpload.addEventListener('change', async (event) => {
  await uploadAsset(event.target.files[0], 'logo');
});

document.getElementById('addLevelBtn').addEventListener('click', () => {
  if (!localState) {
    return;
  }
  localState.levels.push({ durationSec: 900, sb: 500, bb: 1000, ante: 100, isBreak: false });
  emitInitState(localState.levels);
});

document.getElementById('addBreakBtn').addEventListener('click', () => {
  if (!localState) {
    return;
  }
  localState.levels.push({ durationSec: 300, sb: 0, bb: 0, ante: 0, isBreak: true });
  emitInitState(localState.levels);
});

function wireControlButton(id, eventName) {
  const button = document.getElementById(id);
  if (!button) {
    return;
  }
  button.addEventListener('click', () => socket.emit(eventName));
}

wireControlButton('startBtn', 'admin:start');
wireControlButton('pauseBtn', 'admin-pause');
wireControlButton('resumeBtn', 'admin-resume');
wireControlButton('resetBtn', 'admin-reset');
wireControlButton('nextLevelBtn', 'admin:nextLevel');
wireControlButton('prevLevelBtn', 'admin:prevLevel');

wireControlButton('stickyStart', 'admin:start');
wireControlButton('stickyPause', 'admin-pause');
wireControlButton('stickyResume', 'admin-resume');
wireControlButton('stickyReset', 'admin-reset');
wireControlButton('stickyNext', 'admin:nextLevel');
wireControlButton('stickyPrev', 'admin:prevLevel');

document.getElementById('saveSetup').addEventListener('click', () => {
  if (!localState) {
    return;
  }
  emitInitState(localState.levels);
});

document.getElementById('stickySave').addEventListener('click', () => {
  if (!localState) {
    return;
  }
  emitInitState(localState.levels);
});

document.querySelectorAll('[data-test-sound]').forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('sound:event', {
      type: btn.dataset.testSound,
      soundId: document.getElementById(`sound-${btn.dataset.testSound}`).value
    });
  });
});

function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw);
    socket.emit('admin:updateState', saved);
  } catch (error) {
    console.error(error);
  }
}

initSelects();
setupInputListeners();
restoreFromLocalStorage();
