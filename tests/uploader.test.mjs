// Pruebas del cliente de envío (js/uploader.js) con fetch simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CODE = fs.readFileSync(new URL('../js/uploader.js', import.meta.url), 'utf8');

function makeEnv({ endpoint = 'https://script.google.com/macros/s/PRUEBA/exec', responses = [], onLine = true } = {}) {
  const calls = [];
  const queue = [...responses];
  const ctx = {
    QR15_CONFIG: { uploadEndpoint: endpoint },
    navigator: { onLine },
    AbortController,
    clearTimeout,
    // Las esperas entre reintentos se acortan; el tiempo límite de la
    // petición (minutos) no se dispara durante la prueba.
    setTimeout: (fn, ms) => (ms >= 60000 ? 0 : setTimeout(fn, 0)),
    FileReader: class {
      readAsDataURL(file) {
        setTimeout(() => {
          this.result = `data:${file.type};base64,${file.content.toString('base64')}`;
          this.onload();
        }, 0);
      }
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      let next = queue.shift();
      if (typeof next === 'function') next = await next(options);
      if (next instanceof Error) throw next;
      return {
        ok: next.status ? next.status < 400 : true,
        text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body))
      };
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return { ctx, calls, uploadPhoto: ctx.QR15Uploader.uploadPhoto };
}

const item = () => ({
  key: '0b8f0c3e-5f7e-4a51-9d1c-2a3b4c5d6e7f',
  name: 'fiesta.jpg',
  file: { type: 'image/jpeg', content: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]) }
});

async function codeOf(promise) {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return err.code;
  }
}

test('sin endpoint configurado no envía nada', async () => {
  const env = makeEnv({ endpoint: '' });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'not_configured');
  assert.equal(env.calls.length, 0);
});

test('envía la foto como text/plain con clave, nombre y base64', async () => {
  const env = makeEnv({ responses: [{ body: { ok: true } }] });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'ok');
  assert.equal(env.calls.length, 1);
  const { url, options } = env.calls[0];
  assert.equal(url, 'https://script.google.com/macros/s/PRUEBA/exec');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(options.credentials, 'omit');
  const sent = JSON.parse(options.body);
  assert.deepEqual(Object.keys(sent).sort(), ['data', 'key', 'name']);
  assert.equal(sent.key, item().key);
  assert.equal(sent.name, 'fiesta.jpg');
  assert.equal(sent.data, item().file.content.toString('base64'));
});

test('un fallo de red se reintenta con la misma clave', async () => {
  const env = makeEnv({ responses: [new TypeError('Failed to fetch'), { body: { ok: true } }] });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'ok');
  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[0].options.body, env.calls[1].options.body);
});

test('los rechazos y límites no se reintentan', async () => {
  for (const code of ['rejected', 'rate_limited', 'closed', 'not_configured']) {
    const env = makeEnv({ responses: [{ body: { ok: false, code } }] });
    assert.equal(await codeOf(env.uploadPhoto(item())), code);
    assert.equal(env.calls.length, 1, code);
  }
});

test('"too_large" del servidor se muestra como foto rechazada', async () => {
  const env = makeEnv({ responses: [{ body: { ok: false, code: 'too_large' } }] });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'rejected');
});

test('"busy" se reintenta y, si persiste, se informa', async () => {
  const busy = { body: { ok: false, code: 'busy' } };
  const env = makeEnv({ responses: [busy, busy, busy, busy] });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'busy');
  assert.equal(env.calls.length, 4);
});

test('una respuesta que no es JSON (p. ej. página de inicio de sesión) cuenta como error del servidor', async () => {
  const html = { body: '<!DOCTYPE html><title>Iniciar sesión</title>' };
  const env = makeEnv({ responses: [html, html, html, html] });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'server');
});

test('un código desconocido del servidor no se muestra tal cual', async () => {
  const env = makeEnv({ responses: [{ body: { ok: false, code: 'detalle_interno' } }, { body: { ok: true } }] });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'ok', 'se trata como "server" y se reintenta');
});

test('sin conexión no intenta enviar', async () => {
  const env = makeEnv({ onLine: false });
  assert.equal(await codeOf(env.uploadPhoto(item())), 'offline');
  assert.equal(env.calls.length, 0);
});

test('cancelar durante el envío corta la petición y no reintenta', async () => {
  const controller = new AbortController();
  // Petición que no responde hasta que se cancela.
  const hanging = options => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    setTimeout(() => controller.abort(), 0);
  });
  const env = makeEnv({ responses: [hanging, { body: { ok: true } }] });
  assert.equal(await codeOf(env.uploadPhoto(item(), { signal: controller.signal })), 'cancelled');
  assert.equal(env.calls.length, 1);
});

test('cancelar durante la espera entre reintentos no vuelve a enviar', async () => {
  const controller = new AbortController();
  const failThenCancel = () => { controller.abort(); throw new TypeError('Failed to fetch'); };
  const env = makeEnv({ responses: [failThenCancel, { body: { ok: true } }] });
  assert.equal(await codeOf(env.uploadPhoto(item(), { signal: controller.signal })), 'cancelled');
  assert.equal(env.calls.length, 1);
});

test('con la carga ya cancelada no envía nada', async () => {
  const controller = new AbortController();
  controller.abort();
  const env = makeEnv({ responses: [{ body: { ok: true } }] });
  assert.equal(await codeOf(env.uploadPhoto(item(), { signal: controller.signal })), 'cancelled');
  assert.equal(env.calls.length, 0);
});
