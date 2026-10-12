// Pruebas del backend (apps-script/Code.gs) con las APIs de Google
// simuladas: no usan credenciales ni tocan Google Drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CODE = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const NOW = new Date('2026-11-21T20:00:00-06:00');
// Los objetos creados dentro de vm tienen otro prototipo; se comparan como JSON.
const plain = v => JSON.parse(JSON.stringify(v));

function makeEnv(props = {}, { driveError = null, storageLimit = 15 * 1024 ** 3, storageUsed = 2 * 1024 ** 3, sharing = 'PRIVATE' } = {}) {
  const cache = new Map();
  const files = [];
  const logs = [];
  const scriptProps = { FOLDER_ID: 'carpeta-123', ...props };
  const state = { driveError };

  const ctx = {
    console: { log: m => logs.push(m), warn: m => logs.push(m), error: m => logs.push(m) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...scriptProps }),
        getProperty: k => (k in scriptProps ? scriptProps[k] : null),
        setProperty: (k, v) => { scriptProps[k] = String(v); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: k => { cache.delete(k); }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      // Como en Apps Script: bytes con signo (-128..127).
      base64Decode: s => Array.from(Buffer.from(s, 'base64'), b => (b > 127 ? b - 256 : b)),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      formatDate: (date, tz, pattern) => (pattern === 'yyyy-MM-dd' ? '2026-11-21' : '20261121-200000'),
      getUuid: () => crypto.randomUUID()
    },
    Session: { getScriptTimeZone: () => 'America/Guatemala' },
    DriveApp: {
      Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
      getStorageLimit: () => storageLimit,
      getStorageUsed: () => storageUsed,
      getFolderById: (id) => {
        if (state.driveError) throw new Error(state.driveError);
        if (id !== 'carpeta-123') throw new Error('No item with the given ID could be found');
        return {
          getName: () => '15s de Mariana',
          getSharingAccess: () => sharing,
          createFile: (blob, content, mimeType) => {
            const file = typeof blob === 'string'
              ? { name: blob, content, type: mimeType, trashed: false, setTrashed(t) { this.trashed = t; } }
              : { ...blob, description: null, setDescription(d) { this.description = d; } };
            files.push(file);
            return file;
          }
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);

  const post = (body, now = NOW) => {
    const contents = typeof body === 'string' ? body : JSON.stringify(body);
    return plain(ctx.handleUpload_({ postData: { contents } }, now));
  };
  return { ctx, files, cache, logs, scriptProps, state, post };
}

// Imágenes mínimas con la estructura que valida el backend.
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0xFF, 0xD9]);
function png() {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(480, 20);
  return b;
}
function webp() {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8 ', 12, 'latin1');
  return b;
}

let keyCounter = 0;
const newKey = () => `clave-de-prueba-${String(++keyCounter).padStart(4, '0')}`;
const body = (bytes, extra = {}) => ({ key: newKey(), name: 'foto.jpg', data: Buffer.from(bytes).toString('base64'), ...extra });

test('guarda JPEG, PNG y WebP con nombre seguro y la extensión del tipo real', () => {
  const env = makeEnv();
  assert.deepEqual(env.post(body(JPEG)), { ok: true });
  assert.deepEqual(env.post(body(png(), { name: 'baile.jpg' })), { ok: true });
  assert.deepEqual(env.post(body(webp())), { ok: true });

  assert.equal(env.files.length, 3);
  assert.deepEqual(plain(env.files.map(f => f.type)), ['image/jpeg', 'image/png', 'image/webp']);
  // El PNG llamado "baile.jpg" se guarda como .png: manda el contenido.
  env.files.forEach((f, i) => {
    assert.match(f.name, new RegExp(`^20261121-200000_[0-9a-f]{8}\\.${['jpg', 'png', 'webp'][i]}$`));
  });
  assert.equal(new Set(env.files.map(f => f.name)).size, 3, 'los nombres no se repiten');
  assert.equal(env.files[1].description, 'Nombre original: baile.jpg');
});

test('el nombre original se limpia y nunca se usa como ruta', () => {
  const env = makeEnv();
  env.post(body(JPEG, { name: '../../secreto\u0000/foto.jpg' }));
  assert.equal(env.files[0].description, 'Nombre original: .._.._secreto_foto.jpg');
  assert.doesNotMatch(env.files[0].name, /secreto|\//);
});

test('rechaza archivos que no son imágenes aunque digan serlo', () => {
  const env = makeEnv();
  assert.deepEqual(env.post(body(Buffer.from('esto no es una imagen'), { name: 'falsa.jpg' })), { ok: false, code: 'rejected' });
  assert.deepEqual(env.post(body(Buffer.from('%PDF-1.4 ...'))), { ok: false, code: 'rejected' });
  const badPng = png(); badPng.write('XXXX', 12, 'latin1');
  assert.deepEqual(env.post(body(badPng)), { ok: false, code: 'rejected' });
  const badWebp = webp(); badWebp.write('ABCD', 12, 'latin1');
  assert.deepEqual(env.post(body(badWebp)), { ok: false, code: 'rejected' });
  assert.equal(env.files.length, 0);
});

test('rechaza peticiones mal formadas', () => {
  const env = makeEnv();
  assert.deepEqual(env.post('no es json'), { ok: false, code: 'rejected' });
  assert.deepEqual(env.post({ name: 'x', data: JPEG.toString('base64') }), { ok: false, code: 'rejected' });
  assert.deepEqual(env.post({ key: 'corta', data: JPEG.toString('base64') }), { ok: false, code: 'rejected' });
  assert.deepEqual(env.post({ key: newKey(), data: '***' }), { ok: false, code: 'rejected' });
  assert.deepEqual(env.post({ key: newKey(), data: '' }), { ok: false, code: 'rejected' });
  assert.deepEqual(plain(env.ctx.handleUpload_(undefined, NOW)), { ok: false, code: 'rejected' });
});

test('rechaza fotos que superan MAX_FILE_MB', () => {
  const env = makeEnv({ MAX_FILE_MB: '1' });
  const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]);
  assert.deepEqual(env.post(body(big)), { ok: false, code: 'too_large' });
  assert.equal(env.files.length, 0);
});

test('MAX_FILE_MB nunca supera 30 MB, el máximo que cabe en una petición', () => {
  const env = makeEnv({ MAX_FILE_MB: '80' });
  assert.equal(env.ctx.readConfig_().maxFileMb, 30);
  assert.equal(makeEnv().ctx.readConfig_().maxFileMb, 25);
});

test('un reintento con la misma clave no duplica la foto', () => {
  const env = makeEnv();
  const request = body(JPEG);
  assert.deepEqual(env.post(request), { ok: true });
  assert.deepEqual(env.post(request), { ok: true, duplicate: true });
  assert.equal(env.files.length, 1);
});

test('si la misma foto aún se está guardando, responde "busy"', () => {
  const env = makeEnv();
  const request = body(JPEG);
  env.cache.set('k:' + request.key, 'pending');
  assert.deepEqual(env.post(request), { ok: false, code: 'busy' });
  assert.equal(env.files.length, 0);
});

test('sin FOLDER_ID responde "not_configured"', () => {
  const env = makeEnv({ FOLDER_ID: '' });
  assert.deepEqual(env.post(body(JPEG)), { ok: false, code: 'not_configured' });
});

test('una fecha mal escrita deja la carga cerrada como "not_configured"', () => {
  const env = makeEnv({ UPLOADS_OPEN_FROM: '21/11/2026' });
  assert.deepEqual(env.post(body(JPEG)), { ok: false, code: 'not_configured' });
});

test('respeta la ventana de fechas', () => {
  const env = makeEnv({ UPLOADS_OPEN_FROM: '2026-11-21T00:00:00-06:00', UPLOADS_OPEN_UNTIL: '2026-11-30T23:59:59-06:00' });
  assert.deepEqual(env.post(body(JPEG), new Date('2026-11-20T23:00:00-06:00')), { ok: false, code: 'closed' });
  assert.deepEqual(env.post(body(JPEG), new Date('2026-12-01T00:00:00-06:00')), { ok: false, code: 'closed' });
  assert.deepEqual(env.post(body(JPEG)), { ok: true });
});

test('aplica el límite por minuto', () => {
  const env = makeEnv({ MAX_UPLOADS_PER_MINUTE: '2' });
  assert.equal(env.post(body(JPEG)).ok, true);
  assert.equal(env.post(body(JPEG)).ok, true);
  assert.deepEqual(env.post(body(JPEG)), { ok: false, code: 'rate_limited' });
  assert.equal(env.post(body(JPEG), new Date(NOW.getTime() + 60000)).ok, true, 'el minuto siguiente vuelve a aceptar');
});

test('aplica el límite diario y lo reinicia al cambiar de día', () => {
  const env = makeEnv({ MAX_UPLOADS_PER_DAY: '1' });
  assert.equal(env.post(body(JPEG)).ok, true);
  assert.deepEqual(env.post(body(JPEG), new Date(NOW.getTime() + 120000)), { ok: false, code: 'rate_limited' });
  env.scriptProps.COUNTER_DAY = '2026-11-20|1';
  assert.equal(env.post(body(JPEG), new Date(NOW.getTime() + 240000)).ok, true);
});

test('un error de Drive no revela detalles y permite reintentar', () => {
  const env = makeEnv({}, { driveError: 'Access denied: /privado/ruta token=abc' });
  const request = body(JPEG);
  const response = env.ctx.doPost({ postData: { contents: JSON.stringify(request) } });
  assert.equal(response.text, JSON.stringify({ ok: false, code: 'server' }));
  assert.ok(env.logs.some(l => String(l).includes('Access denied')), 'el detalle queda solo en el registro');

  env.state.driveError = null;
  assert.deepEqual(env.post(request), { ok: true }, 'la clave se libera tras el fallo');
  assert.equal(env.files.length, 1);
});

test('doGet responde un JSON simple sin datos internos', () => {
  const env = makeEnv();
  assert.equal(env.ctx.doGet().text, '{"ok":true}');
});

test('checkSetup confirma la escritura, deja la prueba en la papelera e informa el espacio libre', () => {
  const env = makeEnv();
  env.ctx.checkSetup();
  assert.equal(env.files.length, 1);
  assert.equal(env.files[0].trashed, true);
  assert.ok(env.logs.some(l => l.startsWith('Todo listo') && l.includes('15s de Mariana')));
  assert.ok(env.logs.some(l => l === 'Espacio libre en Google Drive: 13.0 GB.'));
});

test('checkSetup avisa si queda poco espacio o si la carpeta es pública', () => {
  const env = makeEnv({}, { storageUsed: 13 * 1024 ** 3, sharing: 'ANYONE_WITH_LINK' });
  env.ctx.checkSetup();
  assert.ok(env.logs.some(l => l.startsWith('ATENCIÓN: Espacio libre en Google Drive: 2.0 GB.')));
  assert.ok(env.logs.some(l => l.includes('compartida con cualquier persona')));
});

test('checkSetup falla con un mensaje claro si falta FOLDER_ID', () => {
  const env = makeEnv({ FOLDER_ID: '' });
  assert.throws(() => env.ctx.checkSetup(), /FOLDER_ID/);
});
