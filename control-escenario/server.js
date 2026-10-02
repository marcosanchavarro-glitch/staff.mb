const express = require('express');
const { createServer } = require('node:http');
const { networkInterfaces } = require('node:os');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const publicPath = path.join(__dirname, 'public');
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, 'staff-mb.sqlite'));
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = 'staff_mb_session';
mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);

const timerTypes = new Set(['stopwatch', 'timer']);
const sectionSizes = new Set(['small', 'normal', 'large']);
const timerSizes = new Set(['normal', 'large', 'xlarge']);
const messageSizes = new Set(['normal', 'large', 'xlarge']);
const messagePositions = new Set(['bottom', 'center']);
const animationStyles = new Set(['subtle', 'none']);
const roles = new Set(['admin', 'multimedia', 'escenario']);
const roleLabels = { admin: 'Administrador', multimedia: 'Multimedia', escenario: 'Escenario' };
const colorPattern = /^#[0-9a-f]{6}$/i;

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    timer_type TEXT NOT NULL DEFAULT 'stopwatch',
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#bbabef',
    show_name INTEGER NOT NULL DEFAULT 1,
    show_time INTEGER NOT NULL DEFAULT 1,
    show_clock INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS quick_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#bbabef',
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS display_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    background_color TEXT NOT NULL DEFAULT '#080809',
    accent_color TEXT NOT NULL DEFAULT '#bbabef',
    section_size TEXT NOT NULL DEFAULT 'normal',
    timer_size TEXT NOT NULL DEFAULT 'large',
    show_brand INTEGER NOT NULL DEFAULT 1,
    show_clock INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_session_id INTEGER,
    current_section_id INTEGER,
    timer_running INTEGER NOT NULL DEFAULT 0,
    timer_has_started INTEGER NOT NULL DEFAULT 0,
    timer_value_ms INTEGER NOT NULL DEFAULT 0,
    timer_started_at INTEGER,
    message_text TEXT NOT NULL DEFAULT '',
    message_color TEXT NOT NULL DEFAULT '#bbabef'
  );

  CREATE TABLE IF NOT EXISTS global_credentials (
    role TEXT PRIMARY KEY CHECK (role IN ('admin', 'multimedia', 'escenario')),
    code_hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'multimedia', 'escenario')),
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('sections', 'responsible', "TEXT NOT NULL DEFAULT ''");
ensureColumn('sections', 'notify_next', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sections', 'notify_minutes', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('app_state', 'next_notice_shown', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('app_state', 'timer_type_override', 'TEXT');
ensureColumn('display_settings', 'message_size', "TEXT NOT NULL DEFAULT 'large'");
ensureColumn('display_settings', 'show_responsible', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('display_settings', 'show_next_section', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('display_settings', 'message_position', "TEXT NOT NULL DEFAULT 'bottom'");
ensureColumn('display_settings', 'notice_duration_seconds', 'INTEGER NOT NULL DEFAULT 7');
ensureColumn('display_settings', 'animation_style', "TEXT NOT NULL DEFAULT 'subtle'");

db.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);');

function transaction(callback) {
  db.exec('BEGIN');
  try {
    callback();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedDatabase() {
  db.prepare(`
    INSERT OR IGNORE INTO display_settings
      (id, background_color, accent_color, section_size, timer_size, show_brand, show_clock)
    VALUES (1, '#080809', '#bbabef', 'normal', 'large', 1, 1)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO app_state
      (id, timer_running, timer_has_started, timer_value_ms, message_text, message_color)
    VALUES (1, 0, 0, 0, '', '#bbabef')
  `).run();

  const sessionCount = db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
  if (sessionCount === 0) {
    transaction(() => {
      const sessionId = Number(db.prepare('INSERT INTO sessions (name) VALUES (?)').run('Culto Domingo').lastInsertRowid);
      const insertSection = db.prepare(`
        INSERT INTO sections
          (session_id, name, timer_type, duration_seconds, color, show_name, show_time, show_clock, position)
        VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?)
      `);
      const defaults = [
        ['ALABANZA', 'stopwatch', 0, '#bbabef'],
        ['ADORACIÓN', 'stopwatch', 0, '#a995e8'],
        ['ANUNCIOS', 'timer', 600, '#70b7d5'],
        ['OFRENDA', 'timer', 600, '#e3b873'],
        ['PRÉDICA', 'timer', 2400, '#e59a62'],
        ['MINISTRACIÓN', 'stopwatch', 0, '#bbabef'],
        ['CIERRE', 'stopwatch', 0, '#a6a1ad']
      ];
      defaults.forEach((section, index) => insertSection.run(sessionId, ...section, index));
      const firstSectionId = Number(db.prepare('SELECT id FROM sections WHERE session_id = ? ORDER BY position LIMIT 1').get(sessionId).id);
      db.prepare('UPDATE app_state SET current_session_id = ?, current_section_id = ? WHERE id = 1').run(sessionId, firstSectionId);
    });
  }

  const quickMessageCount = db.prepare('SELECT COUNT(*) AS count FROM quick_messages').get().count;
  if (quickMessageCount === 0) {
    const insertMessage = db.prepare('INSERT INTO quick_messages (text, color, position) VALUES (?, ?, ?)');
    [
      ['QUEDAN 5 MINUTOS', '#f2c96d'],
      ['QUEDAN 2 MINUTOS', '#f2c96d'],
      ['ÚLTIMA CANCIÓN', '#bbabef'],
      ['CERRAR', '#ef767a']
    ].forEach((message, index) => insertMessage.run(...message, index));
  }
}

seedDatabase();

function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifySecret(secret, stored) {
  const [salt, expectedHex] = String(stored || '').split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(secret, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tableExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function seedGlobalCredentials() {
  const environmentKeys = {
    admin: 'ADMIN_ACCESS_CODE',
    multimedia: 'MULTIMEDIA_ACCESS_CODE',
    escenario: 'ESCENARIO_ACCESS_CODE'
  };
  const legacyAdmin = tableExists('accesses')
    ? db.prepare("SELECT code_hash AS codeHash FROM accesses WHERE role = 'admin' AND revoked_at IS NULL ORDER BY is_primary DESC, id LIMIT 1").get()
    : null;

  for (const role of roles) {
    if (db.prepare('SELECT 1 FROM global_credentials WHERE role = ?').get(role)) continue;
    const configuredCode = String(process.env[environmentKeys[role]] || '').trim();
    if (role === 'admin' && legacyAdmin?.codeHash) {
      db.prepare('INSERT INTO global_credentials (role, code_hash, updated_at) VALUES (?, ?, ?)')
        .run(role, legacyAdmin.codeHash, Date.now());
      continue;
    }
    if (!configuredCode) throw new Error(`${environmentKeys[role]} es obligatoria en la primera ejecución.`);
    db.prepare('INSERT INTO global_credentials (role, code_hash, updated_at) VALUES (?, ?, ?)')
      .run(role, hashSecret(configuredCode), Date.now());
  }

  if (tableExists('device_sessions') && tableExists('accesses')) {
    db.exec(`
      INSERT OR IGNORE INTO auth_sessions (role, token_hash, created_at, expires_at, last_seen_at)
      SELECT a.role, ds.token_hash, ds.created_at, ds.expires_at, ds.last_seen_at
      FROM device_sessions ds JOIN accesses a ON a.id = ds.access_id
      WHERE a.revoked_at IS NULL AND a.role IN ('admin', 'multimedia', 'escenario');
      DROP TABLE device_sessions;
      DROP TABLE accesses;
    `);
  }
}

seedGlobalCredentials();
db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(Date.now());

function normalizeText(value, maxLength = 80) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeColor(value, fallback = '#bbabef') {
  return typeof value === 'string' && colorPattern.test(value) ? value.toLowerCase() : fallback;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [decodeURIComponent(part.slice(0, index).trim()), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function getAuthenticatedSession(cookieHeader) {
  const token = parseCookies(cookieHeader)[sessionCookieName];
  if (!token) return null;
  const row = db.prepare(`
    SELECT id AS deviceSessionId, token_hash AS tokenHash, expires_at AS expiresAt, role
    FROM auth_sessions WHERE token_hash = ?
  `).get(tokenHash(token));
  if (!row || Number(row.expiresAt) <= Date.now()) return null;
  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(Date.now(), row.deviceSessionId);
  return {
    deviceSessionId: Number(row.deviceSessionId),
    tokenHash: row.tokenHash,
    name: roleLabels[row.role],
    role: row.role,
  };
}

function setSessionCookie(res, token) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
}

function clearSessionCookie(res) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function destinationForRole(role) {
  if (role === 'admin') return '/control';
  if (role === 'multimedia') return '/multimedia';
  return '/pantalla';
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    const auth = getAuthenticatedSession(req.headers.cookie);
    if (!auth) return res.redirect('/');
    if (!allowedRoles.includes(auth.role)) {
      return res.status(403).sendFile(path.join(publicPath, 'unauthorized.html'));
    }
    req.auth = auth;
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

function mapSection(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sessionId: Number(row.sessionId),
    name: row.name,
    timerType: row.timerType,
    durationSeconds: Number(row.durationSeconds),
    color: row.color,
    showName: Boolean(row.showName),
    showTime: Boolean(row.showTime),
    showClock: Boolean(row.showClock),
    responsible: row.responsible,
    notifyNext: Boolean(row.notifyNext),
    notifyMinutes: Number(row.notifyMinutes),
    position: Number(row.position)
  };
}

const sectionSelect = `
  SELECT id, session_id AS sessionId, name, timer_type AS timerType,
    duration_seconds AS durationSeconds, color, show_name AS showName,
    show_time AS showTime, show_clock AS showClock, responsible,
    notify_next AS notifyNext, notify_minutes AS notifyMinutes, position
  FROM sections
`;

function getSection(id) {
  return mapSection(db.prepare(`${sectionSelect} WHERE id = ?`).get(id));
}

function getSections(sessionId) {
  return db.prepare(`${sectionSelect} WHERE session_id = ? ORDER BY position, id`).all(sessionId).map(mapSection);
}

function getSessions() {
  return db.prepare('SELECT id, name FROM sessions ORDER BY id').all().map((session) => ({
    id: Number(session.id),
    name: session.name,
    sections: getSections(session.id)
  }));
}

function getQuickMessages() {
  return db.prepare('SELECT id, text, color, position FROM quick_messages ORDER BY position, id').all().map((message) => ({
    id: Number(message.id),
    text: message.text,
    color: message.color,
    position: Number(message.position)
  }));
}

function getDisplaySettings() {
  const row = db.prepare(`
    SELECT background_color AS backgroundColor, accent_color AS accentColor,
      section_size AS sectionSize, timer_size AS timerSize, message_size AS messageSize,
      show_brand AS showBrand, show_clock AS showClock,
      show_responsible AS showResponsible, show_next_section AS showNextSection,
      message_position AS messagePosition, notice_duration_seconds AS noticeDurationSeconds,
      animation_style AS animationStyle
    FROM display_settings WHERE id = 1
  `).get();
  return {
    backgroundColor: row.backgroundColor,
    accentColor: row.accentColor,
    sectionSize: row.sectionSize,
    timerSize: row.timerSize,
    messageSize: row.messageSize,
    showBrand: Boolean(row.showBrand),
    showClock: Boolean(row.showClock),
    showResponsible: Boolean(row.showResponsible),
    showNextSection: Boolean(row.showNextSection),
    messagePosition: row.messagePosition,
    noticeDurationSeconds: Number(row.noticeDurationSeconds),
    animationStyle: row.animationStyle
  };
}

function loadRuntimeState() {
  const row = db.prepare(`
    SELECT current_session_id AS currentSessionId, current_section_id AS currentSectionId,
      timer_running AS timerRunning, timer_has_started AS timerHasStarted,
      timer_value_ms AS timerValueMs, timer_started_at AS timerStartedAt,
      message_text AS messageText, message_color AS messageColor,
      next_notice_shown AS nextNoticeShown, timer_type_override AS timerTypeOverride
    FROM app_state WHERE id = 1
  `).get();
  return {
    currentSessionId: row.currentSessionId == null ? null : Number(row.currentSessionId),
    currentSectionId: row.currentSectionId == null ? null : Number(row.currentSectionId),
    timer: {
      running: Boolean(row.timerRunning),
      hasStarted: Boolean(row.timerHasStarted),
      valueMs: Number(row.timerValueMs),
      startedAt: row.timerStartedAt == null ? null : Number(row.timerStartedAt)
    },
    message: {
      text: row.messageText,
      color: row.messageColor
    },
    nextNoticeShown: Boolean(row.nextNoticeShown),
    timerTypeOverride: timerTypes.has(row.timerTypeOverride) ? row.timerTypeOverride : null
  };
}

const runtime = loadRuntimeState();
let timerInterval = null;

function getCurrentSession() {
  if (runtime.currentSessionId == null) return null;
  const row = db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(runtime.currentSessionId);
  return row ? { id: Number(row.id), name: row.name } : null;
}

function getCurrentSection() {
  return runtime.currentSectionId == null ? null : getSection(runtime.currentSectionId);
}

function ensureRuntimeSelection() {
  let session = getCurrentSession();
  if (!session) {
    const firstSession = db.prepare('SELECT id, name FROM sessions ORDER BY id LIMIT 1').get();
    runtime.currentSessionId = firstSession ? Number(firstSession.id) : null;
    session = getCurrentSession();
  }

  const section = getCurrentSection();
  if (!section || section.sessionId !== runtime.currentSessionId) {
    const firstSection = session ? getSections(session.id)[0] : null;
    runtime.currentSectionId = firstSection?.id ?? null;
    runtime.timerTypeOverride = null;
    resetTimerForCurrentSection(false);
  }
}

function persistRuntime() {
  db.prepare(`
    UPDATE app_state SET
      current_session_id = ?, current_section_id = ?, timer_running = ?,
      timer_has_started = ?, timer_value_ms = ?, timer_started_at = ?,
      message_text = ?, message_color = ?, next_notice_shown = ?, timer_type_override = ?
    WHERE id = 1
  `).run(
    runtime.currentSessionId,
    runtime.currentSectionId,
    Number(runtime.timer.running),
    Number(runtime.timer.hasStarted),
    Math.max(0, Math.round(runtime.timer.valueMs)),
    runtime.timer.startedAt,
    runtime.message.text,
    runtime.message.color,
    Number(runtime.nextNoticeShown),
    runtime.timerTypeOverride
  );
}

function getTimerType() {
  return runtime.timerTypeOverride ?? getCurrentSection()?.timerType ?? 'stopwatch';
}

function getTimerValue() {
  if (!runtime.timer.running) return Math.max(0, runtime.timer.valueMs);
  const delta = Date.now() - runtime.timer.startedAt;
  return getTimerType() === 'timer'
    ? Math.max(0, runtime.timer.valueMs - delta)
    : runtime.timer.valueMs + delta;
}

function resetTimerForCurrentSection(shouldPersist = true) {
  stopTimerUpdates();
  const section = getCurrentSection();
  runtime.timer.running = false;
  runtime.timer.hasStarted = false;
  runtime.timer.startedAt = null;
  runtime.nextNoticeShown = false;
  runtime.timer.valueMs = getTimerType() === 'timer' ? (section?.durationSeconds ?? 0) * 1000 : 0;
  if (shouldPersist) persistRuntime();
}

function freezeTimer() {
  runtime.timer.valueMs = getTimerValue();
  runtime.timer.startedAt = null;
}

function settleFinishedTimer() {
  if (!runtime.timer.running || getTimerType() !== 'timer' || getTimerValue() > 0) return false;
  runtime.timer.valueMs = 0;
  runtime.timer.running = false;
  runtime.timer.hasStarted = true;
  runtime.timer.startedAt = null;
  stopTimerUpdates();
  persistRuntime();
  return true;
}

function getMeetingContext() {
  const sections = runtime.currentSessionId == null ? [] : getSections(runtime.currentSessionId);
  const index = sections.findIndex((section) => section.id === runtime.currentSectionId);
  return {
    previousSection: index > 0 ? sections[index - 1] : null,
    nextSection: index >= 0 && index < sections.length - 1 ? sections[index + 1] : null
  };
}

function getPublicState() {
  settleFinishedTimer();
  const section = getCurrentSection();
  const meeting = getMeetingContext();
  return {
    currentSession: getCurrentSession(),
    currentSection: section,
    previousSection: meeting.previousSection,
    nextSection: meeting.nextSection,
    timer: {
      running: runtime.timer.running,
      hasStarted: runtime.timer.hasStarted,
      type: getTimerType(),
      valueMs: getTimerValue(),
      durationMs: (section?.durationSeconds ?? 0) * 1000
    },
    message: { ...runtime.message },
    displaySettings: getDisplaySettings()
  };
}

function getNextNotice() {
  const nextSection = getMeetingContext().nextSection;
  if (!nextSection) return null;
  const settings = getDisplaySettings();
  return {
    sectionName: nextSection.name,
    responsible: nextSection.responsible,
    color: nextSection.color,
    durationMs: settings.noticeDurationSeconds * 1000
  };
}

function maybeShowNextNotice() {
  const section = getCurrentSection();
  const notice = getNextNotice();
  if (!runtime.timer.running || runtime.nextNoticeShown || !notice) return;
  if (!section?.notifyNext || section.notifyMinutes <= 0) return;

  const thresholdMs = section.notifyMinutes * 60000;
  const timerValue = getTimerValue();
  const reached = getTimerType() === 'timer'
    ? timerValue <= thresholdMs
    : timerValue >= thresholdMs;
  if (!reached) return;

  runtime.nextNoticeShown = true;
  persistRuntime();
  io.emit('next-section:show', notice);
}

function getConfig() {
  return {
    sessions: getSessions(),
    quickMessages: getQuickMessages(),
    displaySettings: getDisplaySettings()
  };
}

function getConfigForRole(role) {
  const config = getConfig();
  if (role === 'admin') return config;
  return {
    sessions: [],
    quickMessages: config.quickMessages,
    displaySettings: config.displaySettings
  };
}

function getConnectedCounts() {
  const counts = { admin: 0, multimedia: 0, escenario: 0 };
  for (const socket of io.sockets.sockets.values()) {
    const role = socket.data.auth?.role;
    if (roles.has(role)) counts[role] += 1;
  }
  return counts;
}

function getConnectionInfo() {
  if (process.env.PUBLIC_URL) {
    return { tabletUrls: [`${process.env.PUBLIC_URL.replace(/\/$/, '')}/pantalla`] };
  }
  const addresses = [];
  Object.values(networkInterfaces()).flat().forEach((address) => {
    if (address && address.family === 'IPv4' && !address.internal) addresses.push(address.address);
  });
  return {
    tabletUrls: [...new Set(addresses)].map((address) => `http://${address}:${port}/pantalla`)
  };
}

function broadcastState() {
  maybeShowNextNotice();
  io.emit('state:update', getPublicState());
}

function broadcastConfig() {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('config:update', getConfigForRole(socket.data.auth?.role));
  }
}

function broadcastConnections() {
  const counts = getConnectedCounts();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.auth?.role === 'admin') socket.emit('connections:update', counts);
  }
}

function startTimerUpdates() {
  clearInterval(timerInterval);
  timerInterval = setInterval(broadcastState, 250);
}

function stopTimerUpdates() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function activateSection(sectionId) {
  const section = getSection(sectionId);
  if (!section || section.sessionId !== runtime.currentSessionId) return;
  if (section.id === runtime.currentSectionId) return;
  runtime.currentSectionId = section.id;
  runtime.timerTypeOverride = null;
  resetTimerForCurrentSection();
  broadcastState();
}

function normalizeSectionPayload(payload) {
  const name = normalizeText(payload?.name, 60);
  const timerType = timerTypes.has(payload?.timerType) ? payload.timerType : 'stopwatch';
  const durationMinutes = Math.max(1, Math.min(999, Number(payload?.durationMinutes) || 1));
  return {
    name,
    timerType,
    durationSeconds: timerType === 'timer' ? Math.round(durationMinutes * 60) : 0,
    color: normalizeColor(payload?.color),
    showName: Number(Boolean(payload?.showName)),
    showTime: Number(Boolean(payload?.showTime)),
    showClock: Number(Boolean(payload?.showClock)),
    responsible: normalizeText(payload?.responsible, 60),
    notifyNext: Number(Boolean(payload?.notifyNext)),
    notifyMinutes: Math.max(0, Math.min(999, Number(payload?.notifyMinutes) || 0))
  };
}

function onSocket(socket, event, allowedRoles, handler) {
  socket.on(event, (payload) => {
    try {
      const row = db.prepare('SELECT role, expires_at AS expiresAt FROM auth_sessions WHERE id = ?')
        .get(socket.data.auth?.deviceSessionId);
      const invalid = !row || Number(row.expiresAt) <= Date.now();
      if (invalid) {
        socket.emit('auth:revoked');
        socket.disconnect(true);
        return;
      }
      if (!allowedRoles.includes(row.role)) {
        socket.emit('action:error', 'No tenés permiso para realizar esta acción.');
        return;
      }
      handler(payload);
    } catch (error) {
      console.error(`[${event}]`, error);
      socket.emit('action:error', 'No se pudo completar la acción.');
    }
  });
}

ensureRuntimeSelection();
persistRuntime();
if (runtime.timer.running) startTimerUpdates();

app.set('trust proxy', isProduction ? 1 : false);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '16kb' }));

const loginAttempts = new Map();
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => {
  const auth = getAuthenticatedSession(req.headers.cookie);
  if (auth) return res.redirect(destinationForRole(auth.role));
  res.sendFile(path.join(publicPath, 'login.html'));
});
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const attempt = loginAttempts.get(ip) ?? { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > attempt.resetAt) Object.assign(attempt, { count: 0, resetAt: now + 15 * 60 * 1000 });
  if (attempt.count >= 10) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });

  const code = typeof req.body?.code === 'string' ? req.body.code.trim().slice(0, 128) : '';
  const candidates = db.prepare('SELECT role, code_hash AS codeHash FROM global_credentials').all();
  const access = code ? candidates.find((candidate) => verifySecret(code, candidate.codeHash)) : null;
  if (!access) {
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
    return res.status(401).json({ error: 'Código inválido.' });
  }

  loginAttempts.delete(ip);
  const token = randomBytes(32).toString('base64url');
  const timestamp = Date.now();
  db.prepare(`
    INSERT INTO auth_sessions (role, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(access.role, tokenHash(token), timestamp, timestamp + 30 * 24 * 60 * 60 * 1000, timestamp);
  setSessionCookie(res, token);
  res.json({ role: access.role, name: roleLabels[access.role], redirect: destinationForRole(access.role) });
});
app.get('/api/me', (req, res) => {
  const auth = getAuthenticatedSession(req.headers.cookie);
  if (!auth) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, role: auth.role, name: auth.name });
});
app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[sessionCookieName];
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get(['/control', '/admin', '/configuracion', '/cultos', '/accesos'], requireRoles('admin'), (_req, res) => {
  res.sendFile(path.join(publicPath, 'control.html'));
});
app.get('/multimedia', requireRoles('admin', 'multimedia'), (_req, res) => {
  res.sendFile(path.join(publicPath, 'multimedia.html'));
});
app.get('/pantalla', requireRoles('admin', 'escenario'), (_req, res) => {
  res.sendFile(path.join(publicPath, 'pantalla.html'));
});
app.use((req, res, next) => req.path.endsWith('.html') ? res.sendStatus(404) : next());
app.use(express.static(publicPath, { index: false }));

io.use((socket, next) => {
  const auth = getAuthenticatedSession(socket.request.headers.cookie);
  if (!auth) return next(new Error('unauthorized'));
  socket.data.auth = auth;
  next();
});

io.on('connection', (socket) => {
  socket.emit('auth:info', { role: socket.data.auth.role, name: socket.data.auth.name });
  socket.emit('config:update', getConfigForRole(socket.data.auth.role));
  socket.emit('state:update', getPublicState());
  socket.emit('connection:info', getConnectionInfo());
  if (socket.data.auth.role === 'admin') socket.emit('connections:update', getConnectedCounts());
  broadcastConnections();
  socket.on('disconnect', broadcastConnections);

  onSocket(socket, 'session:create', ['admin'], (payload) => {
    const name = normalizeText(payload?.name, 60);
    if (!name) return;
    const result = db.prepare('INSERT INTO sessions (name) VALUES (?)').run(name);
    const sessionId = Number(result.lastInsertRowid);
    runtime.currentSessionId = sessionId;
    runtime.currentSectionId = null;
    runtime.timerTypeOverride = null;
    resetTimerForCurrentSection();
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'session:rename', ['admin'], (payload) => {
    const id = Number(payload?.id);
    const name = normalizeText(payload?.name, 60);
    if (!id || !name) return;
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, id);
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'session:delete', ['admin'], (payload) => {
    const id = Number(payload?.id);
    if (!id) return;
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    if (runtime.currentSessionId === id) {
      runtime.currentSessionId = null;
      runtime.currentSectionId = null;
      runtime.timerTypeOverride = null;
      ensureRuntimeSelection();
      resetTimerForCurrentSection();
    }
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'session:open', ['admin'], (payload) => {
    const id = Number(payload?.id);
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
    if (!session) return;
    runtime.currentSessionId = id;
    runtime.currentSectionId = getSections(id)[0]?.id ?? null;
    runtime.timerTypeOverride = null;
    resetTimerForCurrentSection();
    broadcastState();
  });

  onSocket(socket, 'section:create', ['admin'], (payload) => {
    const sessionId = Number(payload?.sessionId);
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    const section = normalizeSectionPayload(payload);
    if (!session || !section.name) return;
    const position = Number(db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM sections WHERE session_id = ?').get(sessionId).position);
    const result = db.prepare(`
      INSERT INTO sections
        (session_id, name, timer_type, duration_seconds, color, show_name, show_time,
          show_clock, responsible, notify_next, notify_minutes, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, section.name, section.timerType, section.durationSeconds, section.color, section.showName, section.showTime, section.showClock, section.responsible, section.notifyNext, section.notifyMinutes, position);
    if (runtime.currentSessionId === sessionId && runtime.currentSectionId == null) {
      runtime.currentSectionId = Number(result.lastInsertRowid);
      resetTimerForCurrentSection();
    }
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'section:update', ['admin'], (payload) => {
    const id = Number(payload?.id);
    const previous = getSection(id);
    const section = normalizeSectionPayload(payload);
    if (!previous || !section.name) return;
    db.prepare(`
      UPDATE sections SET name = ?, timer_type = ?, duration_seconds = ?, color = ?,
        show_name = ?, show_time = ?, show_clock = ?, responsible = ?,
        notify_next = ?, notify_minutes = ? WHERE id = ?
    `).run(section.name, section.timerType, section.durationSeconds, section.color, section.showName, section.showTime, section.showClock, section.responsible, section.notifyNext, section.notifyMinutes, id);
    if (runtime.currentSectionId === id && (previous.timerType !== section.timerType || previous.durationSeconds !== section.durationSeconds)) {
      runtime.timerTypeOverride = null;
      resetTimerForCurrentSection();
    }
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'section:delete', ['admin'], (payload) => {
    const id = Number(payload?.id);
    const section = getSection(id);
    if (!section) return;
    db.prepare('DELETE FROM sections WHERE id = ?').run(id);
    if (runtime.currentSectionId === id) {
      runtime.currentSectionId = getSections(section.sessionId)[0]?.id ?? null;
      runtime.timerTypeOverride = null;
      resetTimerForCurrentSection();
    }
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'section:move', ['admin'], (payload) => {
    const id = Number(payload?.id);
    const direction = payload?.direction === 'up' ? -1 : payload?.direction === 'down' ? 1 : 0;
    const section = getSection(id);
    if (!section || !direction) return;
    const sections = getSections(section.sessionId);
    const index = sections.findIndex((item) => item.id === id);
    const target = sections[index + direction];
    if (!target) return;
    transaction(() => {
      db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(target.position, section.id);
      db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(section.position, target.id);
    });
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'section:activate', ['admin', 'multimedia'], (payload) => activateSection(Number(payload?.id)));

  onSocket(socket, 'meeting:navigate', ['admin', 'multimedia'], (payload) => {
    const context = getMeetingContext();
    const target = payload?.direction === 'previous' ? context.previousSection : payload?.direction === 'next' ? context.nextSection : null;
    if (target) activateSection(target.id);
  });

  onSocket(socket, 'next-section:show', ['admin', 'multimedia'], () => {
    const notice = getNextNotice();
    if (notice) io.emit('next-section:show', notice);
  });

  onSocket(socket, 'timer:start', ['admin', 'multimedia'], () => {
    if (!getCurrentSection() || runtime.timer.running || runtime.timer.hasStarted) return;
    if (getTimerType() === 'timer' && runtime.timer.valueMs <= 0) resetTimerForCurrentSection(false);
    runtime.timer.running = true;
    runtime.timer.hasStarted = true;
    runtime.timer.startedAt = Date.now();
    persistRuntime();
    startTimerUpdates();
    broadcastState();
  });

  onSocket(socket, 'timer:pause', ['admin', 'multimedia'], () => {
    if (!runtime.timer.running) return;
    freezeTimer();
    runtime.timer.running = false;
    stopTimerUpdates();
    persistRuntime();
    broadcastState();
  });

  onSocket(socket, 'timer:resume', ['admin', 'multimedia'], () => {
    if (!getCurrentSection() || runtime.timer.running || !runtime.timer.hasStarted) return;
    if (getTimerType() === 'timer' && runtime.timer.valueMs <= 0) return;
    runtime.timer.running = true;
    runtime.timer.startedAt = Date.now();
    persistRuntime();
    startTimerUpdates();
    broadcastState();
  });

  onSocket(socket, 'timer:reset', ['admin', 'multimedia'], () => {
    resetTimerForCurrentSection();
    broadcastState();
  });

  onSocket(socket, 'timer:adjust', ['admin', 'multimedia'], (payload) => {
    if (getTimerType() !== 'timer') return;
    const minutes = payload?.minutes === 1 ? 1 : payload?.minutes === -1 ? -1 : 0;
    if (!minutes) return;
    const wasRunning = runtime.timer.running;
    if (wasRunning) freezeTimer();
    runtime.timer.valueMs = Math.max(0, runtime.timer.valueMs + minutes * 60000);
    if (runtime.timer.valueMs === 0) runtime.timer.running = false;
    else if (wasRunning) runtime.timer.startedAt = Date.now();
    if (!runtime.timer.running) stopTimerUpdates();
    persistRuntime();
    broadcastState();
  });

  onSocket(socket, 'timer:type:set', ['admin', 'multimedia'], (payload) => {
    const type = timerTypes.has(payload?.type) ? payload.type : null;
    if (!type || !getCurrentSection() || type === getTimerType()) return;
    runtime.timerTypeOverride = type === getCurrentSection().timerType ? null : type;
    resetTimerForCurrentSection();
    broadcastState();
  });

  onSocket(socket, 'message:set', ['admin', 'multimedia'], (payload) => {
    const text = normalizeText(payload?.text, 160);
    if (!text) return;
    runtime.message.text = text;
    runtime.message.color = normalizeColor(payload?.color, getDisplaySettings().accentColor);
    persistRuntime();
    broadcastState();
  });

  onSocket(socket, 'message:clear', ['admin', 'multimedia'], () => {
    runtime.message.text = '';
    persistRuntime();
    broadcastState();
  });

  onSocket(socket, 'quick-message:create', ['admin'], (payload) => {
    const text = normalizeText(payload?.text, 80);
    if (!text) return;
    const color = normalizeColor(payload?.color);
    const position = Number(db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM quick_messages').get().position);
    db.prepare('INSERT INTO quick_messages (text, color, position) VALUES (?, ?, ?)').run(text, color, position);
    broadcastConfig();
  });

  onSocket(socket, 'quick-message:update', ['admin'], (payload) => {
    const id = Number(payload?.id);
    const text = normalizeText(payload?.text, 80);
    if (!id || !text) return;
    db.prepare('UPDATE quick_messages SET text = ?, color = ? WHERE id = ?').run(text, normalizeColor(payload?.color), id);
    broadcastConfig();
  });

  onSocket(socket, 'quick-message:delete', ['admin'], (payload) => {
    const id = Number(payload?.id);
    if (!id) return;
    db.prepare('DELETE FROM quick_messages WHERE id = ?').run(id);
    broadcastConfig();
  });

  onSocket(socket, 'display-settings:update', ['admin'], (payload) => {
    const current = getDisplaySettings();
    const settings = {
      backgroundColor: normalizeColor(payload?.backgroundColor, current.backgroundColor),
      accentColor: normalizeColor(payload?.accentColor, current.accentColor),
      sectionSize: sectionSizes.has(payload?.sectionSize) ? payload.sectionSize : current.sectionSize,
      timerSize: timerSizes.has(payload?.timerSize) ? payload.timerSize : current.timerSize,
      messageSize: messageSizes.has(payload?.messageSize) ? payload.messageSize : current.messageSize,
      showBrand: Number(Boolean(payload?.showBrand)),
      showClock: Number(Boolean(payload?.showClock)),
      showResponsible: Number(Boolean(payload?.showResponsible)),
      showNextSection: Number(Boolean(payload?.showNextSection)),
      messagePosition: messagePositions.has(payload?.messagePosition) ? payload.messagePosition : current.messagePosition,
      noticeDurationSeconds: Math.max(5, Math.min(8, Math.round(Number(payload?.noticeDurationSeconds) || current.noticeDurationSeconds))),
      animationStyle: animationStyles.has(payload?.animationStyle) ? payload.animationStyle : current.animationStyle
    };
    db.prepare(`
      UPDATE display_settings SET background_color = ?, accent_color = ?, section_size = ?,
        timer_size = ?, message_size = ?, show_brand = ?, show_clock = ?, show_responsible = ?,
        show_next_section = ?, message_position = ?, notice_duration_seconds = ?, animation_style = ?
      WHERE id = 1
    `).run(settings.backgroundColor, settings.accentColor, settings.sectionSize, settings.timerSize,
      settings.messageSize, settings.showBrand, settings.showClock, settings.showResponsible,
      settings.showNextSection, settings.messagePosition, settings.noticeDurationSeconds, settings.animationStyle);
    broadcastConfig();
    broadcastState();
  });

  onSocket(socket, 'credential:update', ['admin'], (payload) => {
    const role = roles.has(payload?.role) ? payload.role : null;
    const credential = typeof payload?.credential === 'string' ? payload.credential.trim().slice(0, 128) : '';
    const confirmation = typeof payload?.confirmation === 'string' ? payload.confirmation.trim().slice(0, 128) : '';
    const minimumLength = role === 'admin' ? 8 : 4;
    if (!role || credential.length < minimumLength) {
      socket.emit('credential:error', { role, message: `La clave debe tener al menos ${minimumLength} caracteres.` });
      return;
    }
    if (credential !== confirmation) {
      socket.emit('credential:error', { role, message: 'Las claves no coinciden.' });
      return;
    }
    db.prepare('UPDATE global_credentials SET code_hash = ?, updated_at = ? WHERE role = ?')
      .run(hashSecret(credential), Date.now(), role);
    socket.emit('credential:updated', { role });
  });

  onSocket(socket, 'sessions:close-role', ['admin'], (payload) => {
    const role = payload?.role === 'multimedia' || payload?.role === 'escenario' ? payload.role : null;
    if (!role) return;
    db.prepare('DELETE FROM auth_sessions WHERE role = ?').run(role);
    for (const connectedSocket of io.sockets.sockets.values()) {
      if (connectedSocket.data.auth?.role === role) {
        connectedSocket.emit('auth:revoked');
        connectedSocket.disconnect(true);
      }
    }
    socket.emit('sessions:closed', { role });
    broadcastConnections();
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`STAFF MB: http://localhost:${port}/control`);
  getConnectionInfo().tabletUrls.forEach((url) => console.log(`Tablet: ${url}`));
});
