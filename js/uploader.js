// Servicio de envío de fotos, separado de la interfaz (js/app.js).
// La interfaz solo usa uploadPhoto(item) y los códigos de UploadError.
(() => {
  'use strict';

  // Códigos que la interfaz sabe traducir a mensajes para el visitante:
  // not_configured, offline, network, rejected, rate_limited, closed,
  // server, unknown.
  class UploadError extends Error {
    constructor(code) {
      super(code);
      this.name = 'UploadError';
      this.code = code;
    }
  }

  // item: { file, key, type } — key es un identificador único por foto
  // que el backend usará para no guardar dos veces la misma foto si se
  // reintenta. Resuelve si la foto quedó guardada; si no, lanza UploadError.
  async function uploadPhoto(item) {
    const endpoint = window.QR15_CONFIG.uploadEndpoint;
    if (!endpoint) throw new UploadError('not_configured');
    if (!navigator.onLine) throw new UploadError('offline');

    // La conexión con Google Apps Script se implementa en la Fase 3.
    throw new UploadError('not_configured');
  }

  window.QR15Uploader = { uploadPhoto, UploadError };
})();
