/**
 * Backend de "Comparte tus fotos" (XV Años · Mariana).
 *
 * Se publica como aplicación web de Google Apps Script que se ejecuta con
 * la cuenta de quien la despliega: recibe una foto por petición desde la
 * página (GitHub Pages) y la guarda en la carpeta de Google Drive indicada
 * en las Propiedades de secuencia de comandos. Los visitantes nunca reciben
 * acceso a la carpeta ni a sus archivos.
 *
 * Configuración del proyecto → Propiedades de secuencia de comandos:
 *   FOLDER_ID               (obligatoria) ID de la carpeta de destino.
 *   MAX_FILE_MB             Tamaño máximo por foto. Predeterminado: 25. Máximo: 30.
 *   MAX_UPLOADS_PER_MINUTE  Fotos por minuto (todas las personas). Predeterminado: 120.
 *   MAX_UPLOADS_PER_DAY     Fotos por día (todas las personas). Predeterminado: 3000.
 *   UPLOADS_OPEN_FROM       Opcional. Fecha ISO desde la que se aceptan fotos,
 *                           p. ej. 2026-11-21T00:00:00-06:00
 *   UPLOADS_OPEN_UNTIL      Opcional. Fecha ISO hasta la que se aceptan fotos.
 *
 * Respuesta (siempre JSON): { ok: true } o { ok: false, code: <código> }
 * Códigos: not_configured, closed, rejected, too_large, busy, rate_limited, server.
 * Nunca se devuelven detalles internos; los errores quedan en el registro de
 * ejecuciones, que solo ve el dueño del script.
 */

var DEFAULTS = {
  MAX_FILE_MB: 25,
  MAX_UPLOADS_PER_MINUTE: 120,
  MAX_UPLOADS_PER_DAY: 3000
};

// Una foto viaja en base64 (un 33 % más pesada) y Apps Script admite unos
// 50 MB por petición: por encima de 30 MB por foto dejaría de caber.
var MAX_FILE_MB_LIMIT = 30;

var EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

var KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
var BASE64_PATTERN = /^[A-Za-z0-9+\/]*={0,2}$/;
var DONE_TTL_SECONDS = 21600;  // 6 h, el máximo de CacheService
var PENDING_TTL_SECONDS = 600;
var LOCK_WAIT_MS = 10000;
var MIN_FREE_GB = 5;  // checkSetup avisa si queda menos espacio en Drive

// ---------- Puntos de entrada ----------

function doGet() {
  return json_({ ok: true });
}

function doPost(e) {
  try {
    return json_(handleUpload_(e, new Date()));
  } catch (err) {
    console.error('Error inesperado: ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, code: 'server' });
  }
}

/**
 * Ejecútala una vez desde el editor (botón "Ejecutar") después de definir
 * FOLDER_ID: pide la autorización, comprueba que el script puede escribir
 * en la carpeta y avisa si la carpeta está compartida públicamente.
 */
function checkSetup() {
  var config = readConfig_();
  if (config.error) throw new Error(config.error);
  if (!config.folderId) throw new Error('Falta la propiedad del script FOLDER_ID.');

  var folder = DriveApp.getFolderById(config.folderId);
  var probe = folder.createFile('prueba-de-permisos.txt', 'Archivo de prueba; se envía a la papelera.', 'text/plain');
  probe.setTrashed(true);

  var access = folder.getSharingAccess();
  if (access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK) {
    console.warn('ATENCIÓN: la carpeta "' + folder.getName() + '" está compartida con cualquier persona con el enlace. ' +
      'No es necesario para que la página funcione; se recomienda dejarla privada.');
  }
  console.log('Todo listo: el script puede guardar fotos en la carpeta "' + folder.getName() + '". ' +
    'Límite por foto: ' + config.maxFileMb + ' MB.');

  // Si el Drive se llena durante el evento, las fotos dejan de guardarse.
  var limit = DriveApp.getStorageLimit();
  var used = DriveApp.getStorageUsed();
  if (limit > 0) {
    var freeGb = (limit - used) / Math.pow(1024, 3);
    var message = 'Espacio libre en Google Drive: ' + freeGb.toFixed(1) + ' GB.';
    if (freeGb < MIN_FREE_GB) {
      console.warn('ATENCIÓN: ' + message + ' Puede no alcanzar para las fotos del evento ' +
        '(como referencia, 100 invitados con 20 fotos de 5 MB son unos 10 GB).');
    } else {
      console.log(message);
    }
  }
}

// ---------- Carga ----------

function handleUpload_(e, now) {
  var config = readConfig_();
  if (config.error) {
    console.error(config.error);
    return fail_('not_configured');
  }
  if (!config.folderId) return fail_('not_configured');
  if (!isOpen_(config, now)) return fail_('closed');

  var body = parseBody_(e);
  if (!body) return fail_('rejected');

  var maxBytes = config.maxFileMb * 1024 * 1024;
  if (body.data.length > Math.ceil(maxBytes / 3) * 4 + 4) return fail_('too_large');

  var bytes = Utilities.base64Decode(body.data);
  if (!bytes.length) return fail_('rejected');
  if (bytes.length > maxBytes) return fail_('too_large');

  // El tipo se decide por el contenido real, no por el nombre ni por lo
  // que declare el navegador.
  var type = detectImageType_(bytes);
  if (!type) return fail_('rejected');

  var claim = claimKey_(body.key, config, now);
  if (claim.done) return { ok: true, duplicate: true };
  if (claim.code) return fail_(claim.code);

  try {
    saveToDrive_(config.folderId, bytes, type, body.name, now);
  } catch (err) {
    releaseKey_(body.key);
    console.error('No se pudo guardar en Drive: ' + (err && err.stack ? err.stack : err));
    return fail_('server');
  }
  CacheService.getScriptCache().put('k:' + body.key, 'done', DONE_TTL_SECONDS);
  return { ok: true };
}

function parseBody_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') return null;
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  if (typeof body.key !== 'string' || !KEY_PATTERN.test(body.key)) return null;
  if (typeof body.data !== 'string' || !body.data || body.data.length % 4 !== 0 || !BASE64_PATTERN.test(body.data)) return null;
  return {
    key: body.key,
    data: body.data,
    name: typeof body.name === 'string' ? body.name : ''
  };
}

/**
 * Reconoce JPEG, PNG y WebP por su firma y su estructura básica.
 * Apps Script no puede decodificar imágenes completas; la página ya
 * comprobó en el navegador que cada foto se puede abrir.
 * Los bytes de Utilities.base64Decode tienen signo (-128..127).
 */
function detectImageType_(bytes) {
  var n = bytes.length;
  var u = function (i) { return bytes[i] & 0xFF; };
  var ascii = function (from, to) {
    var s = '';
    for (var i = from; i < to; i++) s += String.fromCharCode(u(i));
    return s;
  };
  var u32be = function (i) { return ((u(i) << 24) >>> 0) + (u(i + 1) << 16) + (u(i + 2) << 8) + u(i + 3); };
  var u32le = function (i) { return u(i) + (u(i + 1) << 8) + (u(i + 2) << 16) + ((u(i + 3) << 24) >>> 0); };

  // JPEG: SOI (FF D8) seguido de otro marcador.
  if (n >= 4 && u(0) === 0xFF && u(1) === 0xD8 && u(2) === 0xFF && u(3) >= 0xC0 && u(3) !== 0xFF) {
    return 'image/jpeg';
  }

  // PNG: firma de 8 bytes y el bloque IHDR con ancho y alto válidos.
  var PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (n >= 33 && PNG_SIGNATURE.every(function (v, i) { return u(i) === v; })) {
    if (ascii(12, 16) === 'IHDR' && u32be(16) > 0 && u32be(20) > 0) return 'image/png';
    return null;
  }

  // WebP: contenedor RIFF/WEBP coherente con un bloque VP8, VP8L o VP8X.
  if (n >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    var riffSize = u32le(4);
    var chunk = ascii(12, 16);
    if (riffSize >= 12 && riffSize + 8 <= n + 1 && (chunk === 'VP8 ' || chunk === 'VP8L' || chunk === 'VP8X')) {
      return 'image/webp';
    }
  }
  return null;
}

// ---------- Duplicados y límites ----------

/**
 * Reserva la clave única que la página genera para cada foto: si un
 * reintento llega cuando la foto ya se guardó, no se vuelve a guardar.
 * También aplica los límites globales de frecuencia.
 */
function claimKey_(key, config, now) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { code: 'busy' };
  try {
    var cache = CacheService.getScriptCache();
    var state = cache.get('k:' + key);
    if (state === 'done') return { done: true };
    if (state === 'pending') return { code: 'busy' };
    if (!takeQuota_(config, now)) return { code: 'rate_limited' };
    cache.put('k:' + key, 'pending', PENDING_TTL_SECONDS);
    return {};
  } finally {
    lock.releaseLock();
  }
}

function releaseKey_(key) {
  CacheService.getScriptCache().remove('k:' + key);
}

// Se llama con el bloqueo del script tomado.
function takeQuota_(config, now) {
  var cache = CacheService.getScriptCache();
  var minuteKey = 'rm:' + Math.floor(now.getTime() / 60000);
  var perMinute = Number(cache.get(minuteKey)) || 0;
  if (perMinute >= config.maxPerMinute) return false;

  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var stored = String(props.getProperty('COUNTER_DAY') || '').split('|');
  var perDay = stored[0] === today ? Number(stored[1]) || 0 : 0;
  if (perDay >= config.maxPerDay) return false;

  cache.put(minuteKey, String(perMinute + 1), 120);
  props.setProperty('COUNTER_DAY', today + '|' + (perDay + 1));
  return true;
}

// ---------- Drive ----------

function saveToDrive_(folderId, bytes, type, originalName, now) {
  // Nombre seguro y único; el original se conserva en la descripción.
  var stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  var suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var fileName = stamp + '_' + suffix + '.' + EXTENSIONS[type];

  var folder = DriveApp.getFolderById(folderId);
  var file = folder.createFile(Utilities.newBlob(bytes, type, fileName));
  var cleanName = cleanName_(originalName);
  if (cleanName) file.setDescription('Nombre original: ' + cleanName);
  return file;
}

function cleanName_(name) {
  return String(name || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\/\\]/g, '_')
    .trim()
    .slice(0, 200);
}

// ---------- Configuración ----------

function readConfig_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var config = {
    folderId: String(props.FOLDER_ID || '').trim(),
    maxFileMb: Math.min(positiveNumber_(props.MAX_FILE_MB, DEFAULTS.MAX_FILE_MB), MAX_FILE_MB_LIMIT),
    maxPerMinute: positiveNumber_(props.MAX_UPLOADS_PER_MINUTE, DEFAULTS.MAX_UPLOADS_PER_MINUTE),
    maxPerDay: positiveNumber_(props.MAX_UPLOADS_PER_DAY, DEFAULTS.MAX_UPLOADS_PER_DAY),
    openFrom: null,
    openUntil: null
  };
  // Una fecha mal escrita no deja la carga abierta sin querer: se
  // considera configuración incompleta.
  var dates = { openFrom: props.UPLOADS_OPEN_FROM, openUntil: props.UPLOADS_OPEN_UNTIL };
  Object.keys(dates).forEach(function (field) {
    var raw = String(dates[field] || '').trim();
    if (!raw) return;
    var date = new Date(raw);
    if (isNaN(date.getTime())) {
      config.error = 'Fecha no válida en ' + (field === 'openFrom' ? 'UPLOADS_OPEN_FROM' : 'UPLOADS_OPEN_UNTIL') + ': ' + raw;
    } else {
      config[field] = date;
    }
  });
  return config;
}

function positiveNumber_(value, fallback) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? n : fallback;
}

function isOpen_(config, now) {
  if (config.openFrom && now < config.openFrom) return false;
  if (config.openUntil && now > config.openUntil) return false;
  return true;
}

function fail_(code) {
  return { ok: false, code: code };
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
