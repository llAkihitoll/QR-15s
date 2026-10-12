// Servicio de envío de fotos, separado de la interfaz (js/app.js).
// La interfaz solo usa uploadPhoto(item) y los códigos de UploadError.
//
// Envía cada foto al backend de Google Apps Script (apps-script/Code.gs)
// como JSON con la imagen en base64. El tipo "text/plain" evita la
// comprobación previa de CORS, que Apps Script no admite.
(() => {
  'use strict';

  // Códigos que la interfaz sabe traducir a mensajes para el visitante:
  // not_configured, offline, network, rejected, busy, rate_limited,
  // closed, server, unknown; y cancelled cuando la persona cancela.
  class UploadError extends Error {
    constructor(code) {
      super(code);
      this.name = 'UploadError';
      this.code = code;
    }
  }

  const SERVER_CODES = ['not_configured', 'closed', 'rejected', 'too_large', 'busy', 'rate_limited', 'server'];
  // Fallos pasajeros que se reintentan solos, con la misma clave: el
  // backend reconoce la clave y nunca guarda dos veces la misma foto.
  const RETRYABLE = ['network', 'busy', 'server'];
  const RETRY_DELAYS_MS = [2000, 5000, 10000];
  // Apps Script corta cada ejecución a los 6 minutos.
  const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

  function throwIfCancelled(signal) {
    if (signal && signal.aborted) throw new UploadError('cancelled');
  }

  // Espera entre reintentos que se interrumpe al cancelar.
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new UploadError('cancelled'));
      };
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new UploadError('unknown'));
      reader.readAsDataURL(file);
    });
  }

  async function send(endpoint, body, signal) {
    // Se corta por tiempo límite o porque la persona canceló.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onCancel = () => controller.abort();
    if (signal) signal.addEventListener('abort', onCancel, { once: true });
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal
      });
    } catch (err) {
      throwIfCancelled(signal);
      throw new UploadError('network');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCancel);
    }
    if (!response.ok) throw new UploadError('server');
    try {
      return JSON.parse(await response.text());
    } catch (err) {
      // Por ejemplo, una página de inicio de sesión de Google si el
      // despliegue no está abierto a "Cualquier persona".
      throw new UploadError('server');
    }
  }

  // item: { file, key, name } — key es un identificador único por foto
  // que el backend usa para no guardar dos veces la misma foto si se
  // reintenta. options.signal (AbortSignal) permite cancelar.
  // Resuelve si la foto quedó guardada; si no, lanza UploadError.
  async function uploadPhoto(item, { signal } = {}) {
    const endpoint = window.QR15_CONFIG.uploadEndpoint;
    if (!endpoint) throw new UploadError('not_configured');
    throwIfCancelled(signal);

    const data = await readAsBase64(item.file);
    const body = JSON.stringify({ key: item.key, name: item.name, data });

    for (let attempt = 0; ; attempt++) {
      throwIfCancelled(signal);
      if (!navigator.onLine) throw new UploadError('offline');
      let code;
      try {
        const result = await send(endpoint, body, signal);
        if (result && result.ok === true) return;
        code = result && SERVER_CODES.includes(result.code) ? result.code : 'server';
      } catch (err) {
        code = err instanceof UploadError ? err.code : 'network';
      }
      if (code === 'too_large') code = 'rejected';
      if (!RETRYABLE.includes(code) || attempt >= RETRY_DELAYS_MS.length) {
        throw new UploadError(code);
      }
      await wait(RETRY_DELAYS_MS[attempt], signal);
    }
  }

  window.QR15Uploader = { uploadPhoto, UploadError };
})();
