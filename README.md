# Comparte tus fotos · XV Años Mariana

Página a la que los invitados llegan escaneando un código QR para subir las fotos que tomaron en la fiesta. Las fotos se guardan, **sin modificar**, en una carpeta privada de tu Google Drive.

```
Celular del invitado ──► Página (GitHub Pages) ──► Google Apps Script ──► Carpeta de Google Drive
                         index.html, css/, js/      apps-script/Code.gs     (privada)
```

- La **página** es estática (HTML, CSS y JavaScript sin dependencias) y se publica en GitHub Pages.
- El **backend** es una aplicación web de Google Apps Script que se ejecuta con tu cuenta. Es la única pieza que puede escribir en la carpeta.
- Los invitados **no necesitan cuenta de Google** y **no reciben ningún permiso** sobre la carpeta ni sus archivos.

## Estructura

| Ruta | Contenido |
|---|---|
| `index.html`, `css/`, `assets/` | Página, con el diseño de la invitación (`Fondo2.png`, `EsquinasFlorales2.png`, tipografía Parisienne). |
| `js/app.js` | Selección, validación, vistas previas, cola de subida y mensajes. |
| `js/uploader.js` | Envío al backend, con reintentos automáticos que no duplican fotos. |
| `js/config.js` | Configuración pública: URL del backend y límites. |
| `apps-script/Code.gs`, `apps-script/appsscript.json` | Código y manifiesto del backend, para pegar en Apps Script. |
| `tests/` | Pruebas automáticas (sin credenciales). |

> GitHub Pages publica todos los archivos del repositorio, incluido `apps-script/`. No pasa nada: ese código no contiene secretos. El ID de la carpeta vive solo en las Propiedades de secuencia de comandos de Apps Script, dentro de Google.

## Configurar Google Drive y el backend

Solo hace falta hacerlo una vez, con la cuenta de Google donde quieres guardar las fotos.

### 1. Crear la carpeta

1. En Google Drive, crea una carpeta, por ejemplo *Fotos XV Mariana*. **Déjala privada**: no la compartas con nadie para que esto funcione.
2. Ábrela y copia su ID de la barra de direcciones: `https://drive.google.com/drive/folders/`**`ESTE_ES_EL_ID`**

### 2. Crear el proyecto de Apps Script

1. Entra en <https://script.google.com> y crea un **Proyecto nuevo**. Ponle un nombre, por ejemplo *QR 15s fotos*.
2. Borra el contenido de `Código.gs` y pega todo el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
3. Ve a **Configuración del proyecto** (ícono del engranaje) y, en **Configuración general**, activa **"Mostrar el archivo de manifiesto appsscript.json en el editor"**.
4. Vuelve al editor, abre `appsscript.json` y reemplaza su contenido por el de [`apps-script/appsscript.json`](apps-script/appsscript.json).
   - La zona horaria es `America/Guatemala` y se usa para nombrar las fotos. Cámbiala si hace falta.
5. Guarda (Ctrl + S).

### 3. Propiedades de secuencia de comandos

En **Configuración del proyecto → Propiedades de secuencia de comandos → Agregar propiedad de secuencia de comandos** (en inglés, *Script Properties*). Al terminar, pulsa **Guardar propiedades de secuencia de comandos**:

| Propiedad | Obligatoria | Valor recomendado | Para qué sirve |
|---|---|---|---|
| `FOLDER_ID` | **Sí** | ID del paso 1 | Carpeta donde se guardan las fotos. |
| `MAX_FILE_MB` | No | `25` | Tamaño máximo por foto. Máximo permitido: 30. **Debe coincidir con `maxFileBytes` de `js/config.js`.** |
| `MAX_UPLOADS_PER_MINUTE` | No | `120` | Fotos por minuto entre todos los invitados. |
| `MAX_UPLOADS_PER_DAY` | No | `3000` | Fotos por día entre todos los invitados. |
| `UPLOADS_OPEN_FROM` | No | `2026-11-21T00:00:00-06:00` | Desde cuándo se aceptan fotos. |
| `UPLOADS_OPEN_UNTIL` | No | `2026-11-30T23:59:59-06:00` | Hasta cuándo se aceptan fotos. |

Las fechas van en formato ISO con zona horaria (`-06:00` es la hora de Guatemala). Si una fecha está mal escrita, el backend **no acepta fotos** y lo deja anotado en el registro de ejecuciones, para que no quede abierto por error. Si no defines fechas, la carga queda abierta siempre.

El script también crea automáticamente la propiedad `COUNTER_DAY`, que es el contador del límite diario. No hace falta tocarla.

### 4. Autorizar y comprobar permisos

1. En el editor, elige la función **`checkSetup`** en la lista de arriba y pulsa **Ejecutar**.
2. Google pedirá autorización:
   - Elige tu cuenta.
   - Como el script es tuyo y no está publicado en Google, aparecerá **"Google no verificó esta app"**. Pulsa **Configuración avanzada → Ir a QR 15s fotos (no seguro)** y luego **Permitir**.
   - Esto lo ves solo tú. Los invitados nunca ven esta pantalla.
3. En el **Registro de ejecución** debe aparecer: `Todo listo: el script puede guardar fotos en la carpeta "…"`.
   - La función crea un archivo de prueba en la carpeta y lo manda a la papelera; así confirma que tiene permiso de escritura.
   - Si la carpeta estuviera compartida con "cualquier persona con el enlace", también verás un aviso. No es necesario compartirla.
   - También muestra el **espacio libre en Google Drive** y avisa si quedan menos de 5 GB. Una cuenta gratuita tiene 15 GB compartidos con Gmail y Google Fotos. Si se llena durante la fiesta, las fotos dejan de guardarse.

**Sobre el permiso que se pide:** el script solicita acceso a Google Drive (`auth/drive`) porque necesita escribir en una carpeta que ya existe. Ese permiso queda dentro de Google y solo lo usa este script. La página y los invitados nunca reciben tokens ni credenciales.

### 5. Publicar la aplicación web

1. Pulsa **Implementar → Nueva implementación**.
2. En el tipo, elige **Aplicación web**.
3. Configura:
   - **Ejecutar como:** *Yo (tu correo)* (en inglés, *Me*).
   - **Quién tiene acceso:** *Cualquier usuario* (en inglés, *Anyone*). No elijas "Cualquier usuario con una cuenta de Google".

   Es imprescindible para que los invitados no necesiten cuenta de Google. Esto **no** da acceso a la carpeta: solo permite enviar fotos a través del script, con sus validaciones.
4. Pulsa **Implementar** y copia la **URL de la aplicación web**. Termina en `/exec`.
5. Pega esa URL en [`js/config.js`](js/config.js):

   ```js
   uploadEndpoint: 'https://script.google.com/macros/s/XXXXXXXX/exec',
   ```

   Esa URL no es una credencial: cualquier visitante la ve igualmente al usar la página.

**Si más adelante cambias `Code.gs`:** usa **Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar**. Así la URL `/exec` se mantiene. Si haces una "Nueva implementación", la URL cambia y tendrías que actualizar `js/config.js`.

### 6. Probar

1. Abre la página (en local o en GitHub Pages) y sube una foto.
2. Debe aparecer en la carpeta con un nombre como `20261121-203015_1a2b3c4d.jpg`.
3. El nombre original queda en la **descripción** del archivo (en Drive: clic derecho → Información del archivo → Detalles).

Si algo falla, revisa **Ejecuciones** en el panel izquierdo de Apps Script. Ahí se registran los errores con detalle; la página solo muestra mensajes generales.

## Publicar en GitHub Pages

1. En GitHub, abre el repositorio `QR-15s` → **Settings → Pages**.
2. En **Build and deployment**:
   - **Source:** *Deploy from a branch*.
   - **Branch:** `master` y carpeta `/ (root)`.
   - Pulsa **Save**.
3. Espera uno o dos minutos. La página queda en:

   **`https://llakihitoll.github.io/QR-15s/`**

   Sigue el mismo patrón que las invitaciones (`https://llakihitoll.github.io/InvitacionMariana15s_Familiar/`). Confírmalo en la parte superior de **Settings → Pages**, donde GitHub muestra la URL real. Si configuras un dominio propio, la URL será otra.
4. Abre esa URL y sube una foto de prueba (paso 6 de arriba).

Notas:

- **No hace falta compilar nada.** GitHub Pages sirve los archivos tal cual. El archivo vacío `.nojekyll` evita que GitHub los procese con Jekyll.
- **Retraso al publicar cambios:** GitHub Pages guarda los archivos en caché hasta unos 10 minutos. Tras un `push`, si no ves el cambio, espera y recarga.
- **Archivos visibles:** GitHub Pages publica todos los archivos del repositorio. Ninguno contiene credenciales; el ID de la carpeta está solo en Apps Script.
- **Buscadores:** la página lleva `noindex`, así que no aparecerá en Google.

## Código QR

Genera el QR **después** de que la URL de GitHub Pages abra la página correctamente.

1. **Usa la URL exacta:** `https://llakihitoll.github.io/QR-15s/`, con `https://` y la `/` final. Así la página abre directamente, sin redirecciones.
2. **Usa un QR estático**, que lleve la URL dentro del propio código. Evita los generadores de "QR dinámico" o con acortador propio: muchos dejan de funcionar al terminar un periodo de prueba o redirigen a publicidad.
3. **Formato para imprimir:**
   - Exporta en PNG grande (1000 px o más) o en SVG.
   - Usa un color oscuro sobre fondo claro. El verde `#2f4a34` de la invitación sobre blanco funciona bien; no lo inviertas (claro sobre oscuro).
   - Deja el margen blanco alrededor ("zona tranquila").
   - Elige corrección de errores **M** o **Q**.
   - Imprímelo de 3 cm × 3 cm como mínimo, o más grande si se escaneará desde lejos (por ejemplo, en un letrero).
4. **Pruébalo antes de imprimir** con la cámara de un iPhone y de un Android. Debe abrir directamente "Comparte tus fotos".

## Antes del evento

- [ ] `checkSetup` muestra "Todo listo" y suficiente espacio libre en Drive.
- [ ] La carpeta sigue **privada** (Compartir → Acceso general → Restringido).
- [ ] Están definidas `UPLOADS_OPEN_FROM` y `UPLOADS_OPEN_UNTIL`, por ejemplo del `2026-11-21T00:00:00-06:00` al `2026-11-30T23:59:59-06:00`, para que la página no acepte fotos fuera de esas fechas.
- [ ] `MAX_FILE_MB` (Apps Script) y `maxFileBytes` (`js/config.js`) tienen el mismo valor (25 MB).
- [ ] La implementación de Apps Script usa la última versión de `Code.gs` (ver "Actualizar el backend").
- [ ] Desde un celular **con datos móviles** (sin Wi-Fi), escanear el QR y subir 2 o 3 fotos. Probar en iPhone y en Android.
- [ ] Borrar de la carpeta las fotos de prueba.
- [ ] Probar el QR ya impreso.

Durante y después del evento, **Ejecuciones** en Apps Script muestra cada envío y los errores, si los hay.

## Actualizar

- **Página** (`index.html`, `css/`, `js/`): `commit` y `push` a `master`. GitHub Pages publica sola en uno o dos minutos.
- **Backend** (`apps-script/Code.gs`): GitHub **no** actualiza Apps Script. Hay que:
  1. Pegar el nuevo `Code.gs` completo en el editor de Apps Script y guardar.
  2. Ir a **Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar**.

  La URL `/exec` no cambia, así que el QR sigue sirviendo. El QR apunta a la página de GitHub Pages, no a Apps Script; cambiar el backend nunca obliga a reimprimirlo.

## Ejecutar en local

No hay dependencias que instalar.

```bash
# dentro de la carpeta QR/
python -m http.server 8000
# abrir http://localhost:8000
```

También funciona abriendo `index.html` con doble clic. Con `uploadEndpoint` vacío, la página muestra "La carga de fotos todavía no está disponible" al intentar subir; nunca simula una carga exitosa.

## Pruebas

Necesitan Node 18 o superior.

```bash
npm test
```

- `tests/apps-script.test.mjs` prueba el backend (`Code.gs`) con las APIs de Google simuladas:
  - Tipos válidos y archivos disfrazados.
  - Nombres seguros.
  - Límites de tamaño, por minuto y por día.
  - Ventana de fechas.
  - Duplicados.
  - Errores de Drive sin filtrar detalles.
- `tests/uploader.test.mjs` prueba el envío del navegador con `fetch` simulado:
  - Formato de la petición.
  - Reintentos con la misma clave.
  - Errores que no se reintentan.
  - Respuestas inesperadas.

Estas pruebas **no** sustituyen una prueba real con tu cuenta (paso 6), porque no se conectan a Google.

## Límites y validación

| | Página (navegador) | Backend (Apps Script) |
|---|---|---|
| Formatos | JPEG, PNG y WebP, reconocidos por el contenido del archivo. La imagen se abre para comprobar que es válida. | JPEG, PNG y WebP, reconocidos por la firma y la estructura del archivo. La extensión guardada es la del tipo real. |
| Tamaño por foto | 25 MB (`maxFileBytes`) | 25 MB (`MAX_FILE_MB`, máximo 30) |
| Fotos por envío | 30 (`maxFiles`) | Se sube una foto por petición. |
| Total por envío | 300 MB (`maxTotalBytes`) | — |
| Frecuencia | — | 120 por minuto y 3000 por día, entre todos los invitados. |
| Duplicados | No permite elegir dos veces la misma foto, ni volver a subir una ya subida en la misma visita. | Cada foto lleva una clave única. Los reintentos con la misma clave no se guardan dos veces (durante 6 h). |

- **Formatos en iPhone:** las fotos suelen estar en formato HEIC. Al elegirlas desde esta página, Safari las convierte automáticamente a JPEG.
- **Por qué el máximo es 30 MB:** cada foto viaja en base64, que la hace un 33 % más pesada, y Apps Script admite unos 50 MB por petición.

## Limitaciones conocidas

- **Un QR público no identifica a nadie.** Cualquiera con el enlace puede subir fotos. Para reducir el abuso:
  - La ventana de fechas.
  - Los límites globales por minuto y por día.
  - La validación estricta del tipo de archivo.
  - La carpeta privada: nadie puede ver ni borrar lo que hay en ella.

  Eliminarlo del todo requeriría pedir inicio de sesión, y se descartó para no complicar la experiencia de los invitados.
- **Apps Script no conoce la IP del visitante**, así que los límites son globales y no por persona. Una sola persona abusiva podría agotar el cupo diario. Si pasa, puedes subir `MAX_UPLOADS_PER_DAY` o cerrar la ventana de fechas.
- **El backend no decodifica la imagen completa.** Revisa su firma y su estructura; la decodificación completa la hace el navegador antes de enviar.
- **El avance se muestra por foto** ("3 de 10"), no en porcentaje de bytes. Medir los bytes obligaría a una comprobación previa de CORS que Apps Script no admite.
- **Fotos HEIC en Android:** en iPhone, Safari convierte las fotos HEIC a JPEG automáticamente. Pero algunos Android, como Samsung con "Fotos de alta eficiencia" activado, guardan en HEIC y el navegador no las convierte. Esas fotos se rechazan con el mensaje "no es una foto JPG, PNG o WebP". Aceptar HEIC requeriría convertirlas, y se decidió subir las fotos sin modificar.
- **Concurrencia:** Apps Script admite unas 30 ejecuciones simultáneas. La página sube de 2 en 2 por invitado y reintenta sola si el servidor está ocupado.
