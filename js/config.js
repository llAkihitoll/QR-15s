// Configuración pública de la página. Aquí NO van credenciales ni el ID
// de la carpeta de Google Drive: esos datos viven solo en el backend.
window.QR15_CONFIG = {
  // URL de la aplicación web de Google Apps Script que recibe las fotos
  // (se configura en la Fase 3). Vacía = la carga está deshabilitada y la
  // página lo indica; nunca se simula una carga exitosa.
  uploadEndpoint: '',

  // Deben coincidir con los límites configurados en el backend.
  maxFileBytes: 20 * 1024 * 1024,   // 20 MB por foto
  maxFiles: 30,                     // fotos por envío
  maxTotalBytes: 300 * 1024 * 1024, // 300 MB por envío

  // Fotos que se suben al mismo tiempo.
  concurrency: 2
};
