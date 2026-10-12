// Configuración pública de la página. Aquí NO van credenciales ni el ID
// de la carpeta de Google Drive: esos datos viven solo en el backend.
window.QR15_CONFIG = {
  // URL de la aplicación web de Google Apps Script que recibe las fotos
  // (termina en /exec; ver README, "Configurar Google Drive"). Es pública
  // por naturaleza: no es una credencial. Vacía = la carga está
  // deshabilitada y la página lo indica; nunca se simula una carga exitosa.
  uploadEndpoint: 'https://script.google.com/macros/s/AKfycbzzKjtMbbR88IpPE8hgGnHbtS2ZZdkD9DgpLZOT9b26RKlJcE-awm-ne5mwwSLV4tI/exec',

  // Deben coincidir con los límites del backend (MAX_FILE_MB en las
  // Propiedades del script de Apps Script).
  // 25 MB por foto. En base64 son ~34 MB por petición, dentro del
  // límite de ~50 MB de Google Apps Script (el máximo prudente es 30 MB).
  maxFileBytes: 25 * 1024 * 1024,
  maxFiles: 30,                     // fotos por envío
  maxTotalBytes: 300 * 1024 * 1024, // 300 MB por envío

  // Fotos que se suben al mismo tiempo.
  concurrency: 2
};
