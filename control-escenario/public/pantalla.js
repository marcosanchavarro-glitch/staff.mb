const socket = io();
const stageSection = document.querySelector('#stage-section');
const stageStatus = document.querySelector('#stage-status');
const stageBrand = document.querySelector('#stage-brand');
const realTime = document.querySelector('#real-time');
const stageClock = document.querySelector('#stage-clock');
const stageTimer = document.querySelector('#stage-timer');
const stageTimerCaption = document.querySelector('#stage-timer-caption');
const stageResponsible = document.querySelector('#stage-responsible');
const stageNext = document.querySelector('#stage-next');
const stageNextSection = document.querySelector('#stage-next-section');
const stageNextResponsible = document.querySelector('#stage-next-responsible');
const stageEvent = document.querySelector('#stage-event');
const stageScheduleMetrics = document.querySelector('#stage-schedule-metrics');
const stageSectionRemaining = document.querySelector('#stage-section-remaining');
const stageGlobalTime = document.querySelector('#stage-global-time');
const stageTotalTime = document.querySelector('#stage-total-time');
const stageMessage = document.querySelector('#stage-message');
const stageMessageText = document.querySelector('#stage-message-text');
const nextNotice = document.querySelector('#next-notice');
const nextNoticeSection = document.querySelector('#next-notice-section');
const nextNoticeResponsible = document.querySelector('#next-notice-responsible');
const nextNoticeCountdown = document.querySelector('#next-notice-countdown');
let renderedSectionId = null;
let renderedMessageKey = '';
let nextNoticeTimer = null;
let nextNoticeExitTimer = null;

function formatTime(valueMs) {
  const totalSeconds = Math.floor(Math.max(0, valueMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateClock() {
  const now = new Date();
  realTime.textContent = now.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  realTime.dateTime = now.toISOString();
}

function renderDisplaySettings(settings, section) {
  document.documentElement.style.setProperty('--stage-bg', settings.backgroundColor);
  document.documentElement.style.setProperty('--stage-accent', settings.accentColor);
  document.body.dataset.sectionSize = settings.sectionSize;
  document.body.dataset.timerSize = settings.timerSize;
  document.body.dataset.messageSize = settings.messageSize;
  document.body.dataset.messagePosition = settings.messagePosition;
  document.body.dataset.animation = settings.animationStyle;
  stageBrand.hidden = !settings.showBrand;
  realTime.hidden = !settings.showClock || (section ? !section.showClock : false);
  stageResponsible.hidden = !settings.showResponsible;
  stageNext.hidden = !settings.showNextSection;
}

function renderMeetingDetails(section, nextSection) {
  stageResponsible.textContent = section?.responsible ? `Encargado: ${section.responsible}` : '';
  stageResponsible.hidden = !section?.responsible || stageResponsible.hidden;
  stageNextSection.textContent = nextSection?.name ?? 'FIN DE LA SESIÓN';
  stageNextResponsible.textContent = nextSection?.responsible || '';
}

function renderSection(section) {
  const nextId = section?.id ?? null;
  stageSection.hidden = section ? !section.showName : false;
  stageClock.hidden = section ? !section.showTime : false;
  document.documentElement.style.setProperty('--section-color', section?.color ?? 'var(--stage-accent)');
  if (renderedSectionId === nextId) return;

  renderedSectionId = nextId;
  hideNextNotice(true);
  stageSection.classList.add('is-changing');
  window.setTimeout(() => {
    stageSection.textContent = section?.name ?? 'SIN SECCIÓN';
    stageSection.classList.remove('is-changing');
  }, 120);
}

function hideNextNotice(immediate = false) {
  window.clearTimeout(nextNoticeTimer);
  window.clearTimeout(nextNoticeExitTimer);
  nextNotice.classList.remove('is-visible');

  if (immediate) {
    nextNotice.hidden = true;
    return;
  }

  nextNoticeExitTimer = window.setTimeout(() => {
    nextNotice.hidden = true;
  }, 300);
}

function showNextNotice(notice) {
  if (!notice?.sectionName) return;
  window.clearTimeout(nextNoticeTimer);
  window.clearTimeout(nextNoticeExitTimer);
  nextNoticeSection.textContent = notice.sectionName;
  nextNoticeResponsible.textContent = notice.responsible || '';
  nextNoticeResponsible.hidden = !notice.responsible;
  nextNotice.style.setProperty('--next-color', notice.color || 'var(--stage-accent)');
  nextNotice.classList.remove('is-automatic', 'is-compact');
  nextNoticeCountdown.textContent = '';
  nextNotice.hidden = false;
  nextNotice.classList.remove('is-visible');
  void nextNotice.offsetWidth;
  nextNotice.classList.add('is-visible');
  const durationMs = Math.min(8000, Math.max(5000, Number(notice.durationMs) || 6500));
  nextNoticeTimer = window.setTimeout(() => hideNextNotice(), durationMs);
}

function renderSchedule(schedule, session) {
  const automatic = Boolean(schedule?.enabled);
  stageEvent.hidden = !automatic;
  stageEvent.textContent = automatic ? session?.name ?? '' : '';
  stageScheduleMetrics.hidden = !automatic;
  if (!automatic) return;
  stageTimer.textContent = formatTime(schedule.sectionElapsedMs);
  stageTimerCaption.textContent = 'TIEMPO DE SECCIÓN';
  stageSectionRemaining.textContent = formatTime(schedule.sectionRemainingMs);
  stageGlobalTime.textContent = formatTime(schedule.globalValueMs);
  stageTotalTime.textContent = formatTime(schedule.totalDurationMs);

  const notice = schedule.notice;
  if (!notice) {
    if (nextNotice.classList.contains('is-automatic')) hideNextNotice(true);
    return;
  }
  window.clearTimeout(nextNoticeTimer);
  window.clearTimeout(nextNoticeExitTimer);
  nextNoticeSection.textContent = notice.sectionName;
  nextNoticeResponsible.textContent = notice.responsible || 'Sin asignar';
  nextNoticeResponsible.hidden = false;
  nextNoticeCountdown.textContent = `EN ${formatTime(notice.remainingMs)}`;
  nextNotice.style.setProperty('--next-color', notice.color || 'var(--stage-accent)');
  nextNotice.hidden = false;
  nextNotice.classList.add('is-visible', 'is-automatic');
  nextNotice.classList.toggle('is-compact', notice.phase === 'compact');
}

function renderTimer(timer) {
  stageTimer.textContent = formatTime(timer.valueMs);
  stageTimerCaption.textContent = timer.type === 'timer' ? 'TIEMPO RESTANTE' : 'TIEMPO TRANSCURRIDO';
}

function renderMessage(message) {
  if (!message.text) {
    stageMessage.hidden = true;
    stageMessageText.textContent = '';
    renderedMessageKey = '';
    return;
  }

  const messageKey = `${message.text}|${message.color}`;
  stageMessageText.textContent = message.text;
  stageMessage.style.setProperty('--message-color', message.color);
  stageMessage.hidden = false;
  if (messageKey === renderedMessageKey) return;

  renderedMessageKey = messageKey;
  stageMessage.classList.remove('is-new');
  requestAnimationFrame(() => stageMessage.classList.add('is-new'));
}

updateClock();
window.setInterval(updateClock, 1000);

socket.on('connect', () => {
  stageStatus.textContent = '● CONECTADO';
  stageStatus.classList.remove('is-offline');
});
socket.on('disconnect', () => {
  stageStatus.textContent = '○ SIN CONEXIÓN';
  stageStatus.classList.add('is-offline');
});
socket.on('state:update', ({ currentSession, currentSection, nextSection, timer, schedule, message, displaySettings }) => {
  renderDisplaySettings(displaySettings, currentSection);
  renderSection(currentSection);
  renderMeetingDetails(currentSection, nextSection);
  renderTimer(timer);
  renderSchedule(schedule, currentSession);
  renderMessage(message);
});
socket.on('next-section:show', showNextNotice);
socket.on('connect_error', (error) => { if (error.message === 'unauthorized') location.assign('/'); });
socket.on('auth:revoked', () => location.assign('/'));
document.querySelector('#stage-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.assign('/');
});
