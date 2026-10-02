const socket = io();
const $ = (id) => document.querySelector(`#${id}`);
let currentState = null;

function formatTime(valueMs) {
  const totalSeconds = Math.floor(Math.max(0, valueMs) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function renderState(state) {
  currentState = state;
  const section = state.currentSection;
  $('operator-session').textContent = state.currentSession?.name ?? 'SIN CULTO ACTIVO';
  $('operator-section').textContent = section?.name ?? 'SIN SECCIÓN';
  $('operator-section').style.color = section?.color ?? '';
  $('operator-responsible').textContent = `Encargado: ${section?.responsible || 'Sin asignar'}`;
  $('operator-timer').textContent = formatTime(state.timer.valueMs);
  $('operator-caption').textContent = state.timer.type === 'timer' ? 'TIEMPO RESTANTE' : 'TIEMPO TRANSCURRIDO';
  $('type-stopwatch').classList.toggle('is-active', state.timer.type === 'stopwatch');
  $('type-timer').classList.toggle('is-active', state.timer.type === 'timer');
  $('operator-adjust').hidden = state.timer.type !== 'timer';
  $('operator-start').disabled = !section || state.timer.running || state.timer.hasStarted;
  $('operator-pause').disabled = !state.timer.running;
  $('operator-resume').disabled = !section || state.timer.running || !state.timer.hasStarted || (state.timer.type === 'timer' && state.timer.valueMs <= 0);
  $('operator-reset').disabled = !section || (!state.timer.running && !state.timer.hasStarted);
  $('operator-previous').disabled = !state.previousSection;
  $('operator-next').disabled = !state.nextSection;
  $('operator-show-next').disabled = !state.nextSection;
  $('operator-next-section').textContent = state.nextSection?.name ?? 'FIN DE LA SESIÓN';
  $('operator-next-responsible').textContent = state.nextSection ? `Encargado: ${state.nextSection.responsible || 'Sin asignar'}` : 'Sin próxima sección';
  $('operator-current-message').textContent = state.message.text || 'SIN MENSAJE';
  $('operator-clear').disabled = !state.message.text;
}

function renderConfig(config) {
  const container = $('operator-quick-messages');
  container.replaceChildren();
  config.quickMessages.forEach((message) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = message.text;
    button.className = 'quick-send';
    button.style.setProperty('--message-color', message.color);
    button.addEventListener('click', () => socket.emit('message:set', { text: message.text, color: message.color }));
    container.append(button);
  });
  if (!$('operator-message').value && config.displaySettings) $('operator-message-color').value = config.displaySettings.accentColor;
}

function bind(id, event, payload) {
  $(id).addEventListener('click', () => socket.emit(event, payload));
}

bind('operator-start', 'timer:start');
bind('operator-pause', 'timer:pause');
bind('operator-resume', 'timer:resume');
bind('operator-reset', 'timer:reset');
bind('operator-minus', 'timer:adjust', { minutes: -1 });
bind('operator-plus', 'timer:adjust', { minutes: 1 });
bind('operator-previous', 'meeting:navigate', { direction: 'previous' });
bind('operator-next', 'meeting:navigate', { direction: 'next' });
bind('operator-show-next', 'next-section:show');
bind('type-stopwatch', 'timer:type:set', { type: 'stopwatch' });
bind('type-timer', 'timer:type:set', { type: 'timer' });

$('operator-message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('operator-message').value.trim();
  if (!text) return;
  socket.emit('message:set', { text, color: $('operator-message-color').value });
  $('operator-message').value = '';
});
$('operator-clear').addEventListener('click', () => socket.emit('message:clear'));
$('operator-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.assign('/');
});

socket.on('connect', () => {
  $('operator-status').textContent = '● CONECTADO';
  $('operator-status').classList.add('is-connected');
});
socket.on('disconnect', () => {
  $('operator-status').textContent = '○ SIN CONEXIÓN';
  $('operator-status').classList.remove('is-connected');
});
socket.on('connect_error', (error) => { if (error.message === 'unauthorized') location.assign('/'); });
socket.on('auth:info', ({ name, role }) => {
  $('operator-name').textContent = `${name} · ${role.toUpperCase()}`;
  $('admin-link').hidden = role !== 'admin';
});
socket.on('auth:revoked', () => location.assign('/'));
socket.on('config:update', renderConfig);
socket.on('state:update', renderState);
socket.on('action:error', (message) => { $('operator-status').textContent = message; });
