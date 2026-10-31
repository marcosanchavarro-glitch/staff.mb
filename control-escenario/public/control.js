const socket = io();
let config = { sessions: [], quickMessages: [], displaySettings: null };
let currentState = null;
let pendingSessionName = '';

const byId = (id) => document.querySelector(`#${id}`);
const connectionStatus = byId('connection-status');
const tabletUrl = byId('tablet-url');
const sessionSelect = byId('session-select');
const sessionName = byId('session-name');
const sessionStatus = byId('session-status');
const sectionList = byId('section-list');
const currentSection = byId('current-section');
const currentResponsible = byId('current-responsible');
const liveSession = byId('live-session');
const nextSection = byId('next-section');
const nextResponsible = byId('next-responsible');
const showNextSection = byId('show-next-section');
const timerDisplay = byId('control-timer');
const timerCaption = byId('timer-caption');
const timerTypeLabel = byId('timer-type-label');
const timerStart = byId('timer-start');
const timerPause = byId('timer-pause');
const timerResume = byId('timer-resume');
const timerReset = byId('timer-reset');
const timerAdjust = byId('timer-adjust');
const currentMessage = byId('current-message');
const messageForm = byId('message-form');
const messageInput = byId('message');
const messageColor = byId('message-color');
const messageClear = byId('message-clear');
const quickMessageButtons = byId('quick-message-buttons');

function formatTime(valueMs) {
  const totalSeconds = Math.floor(Math.max(0, valueMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function selectedSession() {
  const id = Number(sessionSelect.value);
  return config.sessions.find((session) => session.id === id) ?? null;
}

function makeButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', handler);
  return button;
}

function renderConnection(connected) {
  connectionStatus.classList.toggle('is-offline', !connected);
  connectionStatus.querySelector('p').innerHTML = connected
    ? 'CONECTADO <span>Configuración y reunión sincronizadas en tiempo real.</span>'
    : 'SIN CONEXIÓN <span>Intentando reconectar con STAFF MB.</span>';
}

function renderSessions() {
  const previousSelection = Number(sessionSelect.value);
  sessionSelect.replaceChildren();

  if (config.sessions.length === 0) {
    const option = new Option('No hay sesiones', '');
    sessionSelect.add(option);
    sessionName.value = '';
    return;
  }

  config.sessions.forEach((session) => sessionSelect.add(new Option(session.name, String(session.id))));
  const currentSessionId = currentState?.currentSession?.id;
  let selectedId = config.sessions.some((session) => session.id === previousSelection)
    ? previousSelection
    : config.sessions.some((session) => session.id === currentSessionId)
      ? currentSessionId
      : config.sessions[0].id;

  if (pendingSessionName) {
    const created = [...config.sessions].reverse().find((session) => session.name === pendingSessionName);
    if (created) selectedId = created.id;
    pendingSessionName = '';
  }

  sessionSelect.value = String(selectedId);
  const session = selectedSession();
  sessionName.value = session?.name ?? '';
  byId('session-automatic').checked = Boolean(session?.automaticMode);
  byId('session-notice-seconds').value = String(session?.noticeSeconds ?? 20);
  const totalMs = (session?.sections ?? []).reduce((sum, section) => sum + section.scheduleDurationSeconds * 1000, 0);
  byId('session-total-duration').textContent = `DURACIÓN TOTAL · ${formatTime(totalMs)}`;
}

function renderSectionList() {
  const session = selectedSession();
  sectionList.replaceChildren();

  if (!session || session.sections.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Esta sesión todavía no tiene secciones.';
    sectionList.append(empty);
    return;
  }

  session.sections.forEach((section, index) => {
    const row = document.createElement('div');
    row.className = 'section-row';
    row.style.setProperty('--item-color', section.color);
    if (currentState?.currentSection?.id === section.id) row.classList.add('selected');

    const activate = makeButton('', 'section-activate', () => socket.emit('section:activate', { id: section.id }));
    activate.disabled = currentState?.currentSession?.id !== section.sessionId;
    const number = document.createElement('span');
    number.className = 'section-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('span');
    text.className = 'section-row-text';
    const name = document.createElement('strong');
    name.textContent = section.name;
    const meta = document.createElement('small');
    const timeDescription = section.timerType === 'timer'
      ? `Temporizador · ${Math.round(section.durationSeconds / 60)} min`
      : 'Cronómetro';
    const scheduleDescription = session.automaticMode ? ` · Cronograma ${Math.round(section.scheduleDurationSeconds / 60)} min` : '';
    meta.textContent = section.responsible
      ? `${timeDescription}${scheduleDescription} · Encargado: ${section.responsible}`
      : `${timeDescription}${scheduleDescription}`;
    text.append(name, meta);
    activate.append(number, text);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const edit = makeButton('EDITAR', 'mini-button', () => fillSectionForm(section));
    const up = makeButton('↑', 'icon-button', () => socket.emit('section:move', { id: section.id, direction: 'up' }));
    const down = makeButton('↓', 'icon-button', () => socket.emit('section:move', { id: section.id, direction: 'down' }));
    const remove = makeButton('×', 'icon-button danger-button', () => socket.emit('section:delete', { id: section.id }));
    up.disabled = index === 0;
    down.disabled = index === session.sections.length - 1;
    actions.append(edit, up, down, remove);
    row.append(activate, actions);
    sectionList.append(row);
  });
}

function resetSectionForm() {
  byId('section-id').value = '';
  byId('section-name').value = '';
  byId('section-timer-type').value = 'stopwatch';
  byId('section-duration').value = '40';
  byId('section-schedule-duration').value = '5';
  byId('section-color').value = config.displaySettings?.accentColor ?? '#bbabef';
  byId('section-responsible').value = '';
  byId('section-show-name').checked = true;
  byId('section-show-time').checked = true;
  byId('section-show-clock').checked = true;
  byId('section-notify-next').checked = false;
  byId('section-notify-minutes').value = '25';
  byId('section-editor-mode').textContent = 'NUEVA';
  renderDurationField();
  renderNoticeFields();
}

function fillSectionForm(section) {
  byId('section-id').value = String(section.id);
  byId('section-name').value = section.name;
  byId('section-timer-type').value = section.timerType;
  byId('section-duration').value = String(Math.max(1, Math.round(section.durationSeconds / 60)));
  byId('section-schedule-duration').value = String(Math.max(1, Math.round(section.scheduleDurationSeconds / 60)));
  byId('section-color').value = section.color;
  byId('section-responsible').value = section.responsible ?? '';
  byId('section-show-name').checked = section.showName;
  byId('section-show-time').checked = section.showTime;
  byId('section-show-clock').checked = section.showClock;
  byId('section-notify-next').checked = section.notifyNext;
  byId('section-notify-minutes').value = String(section.notifyMinutes || (section.timerType === 'timer' ? 1 : 25));
  byId('section-editor-mode').textContent = 'EDITANDO';
  renderDurationField();
  renderNoticeFields();
  byId('section-name').focus();
}

function renderDurationField() {
  byId('duration-field').hidden = byId('section-timer-type').value !== 'timer';
  byId('schedule-duration-field').hidden = !selectedSession()?.automaticMode;
}

function renderNoticeFields() {
  const isTimer = byId('section-timer-type').value === 'timer';
  byId('notify-minutes-label').textContent = isTimer
    ? 'Avisar cuando falten (minutos)'
    : 'Avisar después de (minutos)';
  byId('section-notify-minutes').disabled = !byId('section-notify-next').checked;
}

function renderQuickMessages() {
  quickMessageButtons.replaceChildren();
  const select = byId('quick-message-select');
  const previousSelection = Number(select.value);
  select.replaceChildren();

  if (config.quickMessages.length === 0) {
    select.add(new Option('No hay mensajes rápidos', ''));
  }

  config.quickMessages.forEach((message) => {
    const button = makeButton(message.text, 'quick-send', () => {
      socket.emit('message:set', { text: message.text, color: message.color });
    });
    button.style.setProperty('--message-color', message.color);
    quickMessageButtons.append(button);
    select.add(new Option(message.text, String(message.id)));
  });

  const selectedId = config.quickMessages.some((message) => message.id === previousSelection)
    ? previousSelection
    : config.quickMessages[0]?.id;
  if (selectedId) {
    select.value = String(selectedId);
    fillQuickMessageForm();
  } else {
    resetQuickMessageForm();
  }
}

function fillQuickMessageForm() {
  const message = config.quickMessages.find((item) => item.id === Number(byId('quick-message-select').value));
  if (!message) return resetQuickMessageForm();
  byId('quick-message-id').value = String(message.id);
  byId('quick-message-text').value = message.text;
  byId('quick-message-color').value = message.color;
}

function resetQuickMessageForm() {
  byId('quick-message-id').value = '';
  byId('quick-message-text').value = '';
  byId('quick-message-color').value = config.displaySettings?.accentColor ?? '#bbabef';
}

function renderDisplaySettings() {
  const settings = config.displaySettings;
  if (!settings) return;
  byId('background-color').value = settings.backgroundColor;
  byId('accent-color').value = settings.accentColor;
  byId('section-size').value = settings.sectionSize;
  byId('timer-size').value = settings.timerSize;
  byId('message-size').value = settings.messageSize;
  byId('message-position').value = settings.messagePosition;
  byId('notice-duration').value = String(settings.noticeDurationSeconds);
  byId('animation-style').value = settings.animationStyle;
  byId('show-brand').checked = settings.showBrand;
  byId('show-global-clock').checked = settings.showClock;
  byId('show-responsible').checked = settings.showResponsible;
  byId('show-next-section').checked = settings.showNextSection;
  if (!messageInput.value) messageColor.value = settings.accentColor;
}

function renderConnections(counts) {
  byId('connected-admin').textContent = String(counts.admin ?? 0);
  byId('connected-multimedia').textContent = String(counts.multimedia ?? 0);
  byId('connected-escenario').textContent = String(counts.escenario ?? 0);
}

function renderTimer(timer) {
  timerDisplay.textContent = formatTime(timer.valueMs);
  const isCountdown = timer.type === 'timer';
  timerCaption.textContent = isCountdown ? 'TIEMPO RESTANTE' : 'TIEMPO TRANSCURRIDO';
  timerTypeLabel.textContent = isCountdown ? 'TEMPORIZADOR' : 'CRONÓMETRO';
  timerAdjust.hidden = !isCountdown;

  const hasSection = Boolean(currentState?.currentSection);
  timerStart.disabled = !hasSection || timer.running || timer.hasStarted;
  timerPause.disabled = !timer.running;
  timerResume.disabled = !hasSection || timer.running || !timer.hasStarted || (isCountdown && timer.valueMs <= 0);
  timerReset.disabled = !hasSection || (!timer.running && !timer.hasStarted);
}

function renderSchedule(schedule) {
  byId('schedule-summary').hidden = !schedule?.enabled;
  if (!schedule?.enabled) return;
  byId('control-global-timer').textContent = formatTime(schedule.globalValueMs);
  byId('control-section-remaining').textContent = formatTime(schedule.sectionRemainingMs);
  byId('control-total-duration').textContent = formatTime(schedule.totalDurationMs);
}

function renderMessage(message) {
  const hasMessage = Boolean(message.text);
  currentMessage.textContent = hasMessage ? message.text : 'SIN MENSAJE ACTIVO';
  currentMessage.classList.toggle('is-empty', !hasMessage);
  currentMessage.style.color = hasMessage ? message.color : '';
  messageClear.disabled = !hasMessage;
}

function renderState(state) {
  currentState = state;
  liveSession.textContent = state.currentSession?.name ?? 'SIN SESIÓN';
  sessionStatus.textContent = state.currentSession ? `ABIERTA · ${state.currentSession.name}` : 'SIN SESIÓN ABIERTA';
  currentSection.textContent = state.currentSection?.name ?? 'SIN SECCIÓN';
  currentSection.style.color = state.currentSection?.color ?? '';
  currentResponsible.textContent = `Encargado: ${state.currentSection?.responsible || 'Sin asignar'}`;
  nextSection.textContent = state.nextSection?.name ?? 'FIN DE LA SESIÓN';
  nextResponsible.textContent = state.nextSection
    ? `Encargado: ${state.nextSection.responsible || 'Sin asignar'}`
    : 'Sin próxima sección';
  showNextSection.disabled = !state.nextSection;
  byId('section-previous').disabled = !state.previousSection;
  byId('section-next').disabled = !state.nextSection;
  renderTimer(state.timer);
  renderSchedule(state.schedule);
  renderMessage(state.message);
  renderSectionList();
}

function renderConfig(nextConfig) {
  config = nextConfig;
  renderSessions();
  renderSectionList();
  renderQuickMessages();
  renderDisplaySettings();
}

sessionSelect.addEventListener('change', () => {
  const session = selectedSession();
  sessionName.value = session?.name ?? '';
  byId('session-automatic').checked = Boolean(session?.automaticMode);
  byId('session-notice-seconds').value = String(session?.noticeSeconds ?? 20);
  renderSectionList();
  resetSectionForm();
});

byId('session-create').addEventListener('click', () => {
  const name = sessionName.value.trim();
  if (!name) return;
  pendingSessionName = name;
  socket.emit('session:create', { name });
});
byId('session-rename').addEventListener('click', () => {
  const session = selectedSession();
  const name = sessionName.value.trim();
  if (session && name) socket.emit('session:rename', { id: session.id, name });
});
byId('session-delete').addEventListener('click', () => {
  const session = selectedSession();
  if (session) socket.emit('session:delete', { id: session.id });
});
byId('session-open').addEventListener('click', () => {
  const session = selectedSession();
  if (session) socket.emit('session:open', { id: session.id });
});
byId('session-settings-save').addEventListener('click', () => {
  const session = selectedSession();
  if (!session) return;
  socket.emit('session:settings', {
    id: session.id,
    automaticMode: byId('session-automatic').checked,
    noticeSeconds: Number(byId('session-notice-seconds').value)
  });
});

byId('section-new').addEventListener('click', resetSectionForm);
byId('section-cancel').addEventListener('click', resetSectionForm);
byId('section-timer-type').addEventListener('change', () => {
  renderDurationField();
  renderNoticeFields();
});
byId('section-notify-next').addEventListener('change', renderNoticeFields);
byId('section-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const session = selectedSession();
  if (!session) return;
  const payload = {
    id: Number(byId('section-id').value) || undefined,
    sessionId: session.id,
    name: byId('section-name').value,
    timerType: byId('section-timer-type').value,
    durationMinutes: Number(byId('section-duration').value),
    scheduleDurationMinutes: Number(byId('section-schedule-duration').value),
    color: byId('section-color').value,
    responsible: byId('section-responsible').value,
    notifyNext: byId('section-notify-next').checked,
    notifyMinutes: Number(byId('section-notify-minutes').value),
    showName: byId('section-show-name').checked,
    showTime: byId('section-show-time').checked,
    showClock: byId('section-show-clock').checked
  };
  socket.emit(payload.id ? 'section:update' : 'section:create', payload);
  resetSectionForm();
});

timerStart.addEventListener('click', () => socket.emit('timer:start'));
timerPause.addEventListener('click', () => socket.emit('timer:pause'));
timerResume.addEventListener('click', () => socket.emit('timer:resume'));
timerReset.addEventListener('click', () => socket.emit('timer:reset'));
byId('timer-plus').addEventListener('click', () => socket.emit('timer:adjust', { minutes: 1 }));
byId('timer-minus').addEventListener('click', () => socket.emit('timer:adjust', { minutes: -1 }));
byId('section-previous').addEventListener('click', () => socket.emit('meeting:navigate', { direction: 'previous' }));
byId('section-next').addEventListener('click', () => socket.emit('meeting:navigate', { direction: 'next' }));
showNextSection.addEventListener('click', () => socket.emit('next-section:show'));

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('message:set', { text, color: messageColor.value });
  messageInput.value = '';
});
messageClear.addEventListener('click', () => socket.emit('message:clear'));

byId('quick-message-select').addEventListener('change', fillQuickMessageForm);
byId('quick-message-new').addEventListener('click', resetQuickMessageForm);
byId('quick-message-delete').addEventListener('click', () => {
  const id = Number(byId('quick-message-id').value);
  if (id) socket.emit('quick-message:delete', { id });
});
byId('quick-message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = Number(byId('quick-message-id').value) || undefined;
  const payload = {
    id,
    text: byId('quick-message-text').value,
    color: byId('quick-message-color').value
  };
  socket.emit(id ? 'quick-message:update' : 'quick-message:create', payload);
});

byId('display-settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('display-settings:update', {
    backgroundColor: byId('background-color').value,
    accentColor: byId('accent-color').value,
    sectionSize: byId('section-size').value,
    timerSize: byId('timer-size').value,
    messageSize: byId('message-size').value,
    messagePosition: byId('message-position').value,
    noticeDurationSeconds: Number(byId('notice-duration').value),
    animationStyle: byId('animation-style').value,
    showBrand: byId('show-brand').checked,
    showClock: byId('show-global-clock').checked,
    showResponsible: byId('show-responsible').checked,
    showNextSection: byId('show-next-section').checked
  });
});

document.querySelectorAll('.credential-form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const credential = form.elements.credential.value.trim();
    const confirmation = form.elements.confirmation.value.trim();
    const status = form.querySelector('.credential-status');
    status.classList.remove('is-success');
    if (credential !== confirmation) {
      status.textContent = 'Las claves no coinciden.';
      return;
    }
    status.textContent = 'Guardando…';
    socket.emit('credential:update', { role: form.dataset.role, credential, confirmation });
  });
});

document.querySelectorAll('.close-role-sessions').forEach((button) => {
  button.addEventListener('click', () => socket.emit('sessions:close-role', { role: button.dataset.role }));
});

byId('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/');
});

socket.on('connect', () => renderConnection(true));
socket.on('disconnect', () => renderConnection(false));
socket.on('connect_error', (error) => {
  if (error.message === 'unauthorized') window.location.assign('/');
});
socket.on('connection:info', ({ tabletUrls }) => {
  tabletUrl.textContent = tabletUrls[0] ?? 'http://IP-DE-LA-PC:3000/pantalla';
});
socket.on('auth:info', ({ name }) => { byId('auth-name').textContent = name; });
socket.on('auth:revoked', () => window.location.assign('/'));
socket.on('config:update', renderConfig);
socket.on('state:update', renderState);
socket.on('connections:update', renderConnections);
socket.on('credential:updated', ({ role }) => {
  const form = document.querySelector(`.credential-form[data-role="${role}"]`);
  if (!form) return;
  form.reset();
  const status = form.querySelector('.credential-status');
  status.textContent = 'Credencial actualizada.';
  status.classList.add('is-success');
});
socket.on('credential:error', ({ role, message }) => {
  const form = document.querySelector(`.credential-form[data-role="${role}"]`);
  if (form) form.querySelector('.credential-status').textContent = message;
});
socket.on('sessions:closed', ({ role }) => {
  const form = document.querySelector(`.credential-form[data-role="${role}"]`);
  if (!form) return;
  const status = form.querySelector('.credential-status');
  status.textContent = 'Sesiones cerradas.';
  status.classList.add('is-success');
});
socket.on('action:error', (message) => {
  connectionStatus.classList.add('is-offline');
  connectionStatus.querySelector('p').textContent = message;
});

resetSectionForm();
