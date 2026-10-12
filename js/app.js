(() => {
  'use strict';

  const CONFIG = window.QR15_CONFIG;
  const { uploadPhoto } = window.QR15Uploader;

  const THUMB_PX = 320;

  // ---------- Textos ----------

  const REJECT_REASONS = {
    duplicate: 'ya está en tu selección',
    uploaded: 'ya la subiste hace un momento',
    count: `ya tienes el máximo de ${CONFIG.maxFiles} fotos por envío`,
    empty: 'el archivo está vacío',
    size: `pesa más de ${formatSize(CONFIG.maxFileBytes)}`,
    total: `se superaría el límite de ${formatSize(CONFIG.maxTotalBytes)} por envío`,
    type: 'no es una foto JPG, PNG o WebP',
    decode: 'no se pudo abrir como imagen'
  };

  const UPLOAD_ERRORS = {
    not_configured: 'La carga de fotos todavía no está disponible. Inténtalo más tarde.',
    offline: 'No hay conexión a internet. Revísala e inténtalo de nuevo.',
    network: 'Se perdió la conexión. Inténtalo de nuevo.',
    rejected: 'El servidor no aceptó la foto por su formato o tamaño.',
    busy: 'El servidor está ocupado en este momento. Inténtalo de nuevo en unos minutos.',
    rate_limited: 'Se están recibiendo muchas fotos. Espera unos minutos e inténtalo de nuevo.',
    closed: 'La carga de fotos no está abierta en este momento.',
    server: 'No se pudo guardar la foto. Inténtalo de nuevo en unos minutos.',
    unknown: 'Ocurrió un problema inesperado. Inténtalo de nuevo.'
  };

  // Etiqueta corta que aparece bajo cada miniatura.
  const ITEM_ERRORS = {
    not_configured: 'No disponible',
    offline: 'Sin conexión',
    network: 'Sin conexión',
    rejected: 'Rechazada',
    busy: 'Intenta más tarde',
    rate_limited: 'Intenta más tarde',
    closed: 'No disponible',
    server: 'No se subió',
    unknown: 'No se subió'
  };

  const STATUS_LABELS = {
    ready: '',
    queued: 'En espera',
    uploading: 'Subiendo…',
    done: 'Subida'
  };

  // ---------- Elementos ----------

  const content = document.getElementById('content');
  const fileInput = document.getElementById('fileInput');
  const grid = document.getElementById('photoGrid');
  const statusText = document.getElementById('statusText');
  const statusProgress = document.getElementById('statusProgress');
  const notice = document.getElementById('notice');
  const noticeTitle = document.getElementById('noticeTitle');
  const noticeList = document.getElementById('noticeList');
  const pickBtn = document.getElementById('pickBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const addMoreBtn = document.getElementById('addMoreBtn');
  const clearBtn = document.getElementById('clearBtn');

  document.querySelectorAll('[data-limit]').forEach((el) => {
    const key = el.getAttribute('data-limit');
    el.textContent = key.endsWith('Bytes') ? formatSize(CONFIG[key]) : String(CONFIG[key]);
  });

  // ---------- Estado ----------

  // Cada foto: { id, key, file, name, size, type, fingerprint, thumbUrl,
  //              status: ready|queued|uploading|done|failed, error, el }
  let items = [];
  let busy = null;          // null | 'validating' | 'uploading'
  let finished = false;     // hay un resumen de carga visible
  let nextId = 1;
  // Fotos ya guardadas en esta visita: evita volver a subirlas por error.
  const uploadedFingerprints = new Set();

  const pendingItems = () => items.filter(i => i.status !== 'done');
  const sendableItems = () => items.filter(i => i.status === 'ready' || i.status === 'failed');

  // ---------- Utilidades ----------

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const mb = bytes / (1024 * 1024);
    return `${(mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10).toString().replace('.', ',')} MB`;
  }

  function plural(n, one, many) {
    return n === 1 ? one : many.replace('#', n);
  }

  function randomKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  // Tipo real según los primeros bytes del archivo; no se confía en la
  // extensión ni en el tipo que declara el navegador.
  async function sniffType(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length >= 8 && [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every((v, i) => b[i] === v)) return 'image/png';
    if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    return null;
  }

  // Decodifica la imagen (si no se puede, se rechaza) y genera una
  // miniatura pequeña para no mantener en memoria fotos de varios MB.
  // La foto original no se modifica: es la que se sube.
  function makeThumbnail(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) {
          URL.revokeObjectURL(url);
          reject(new Error('decode'));
          return;
        }
        try {
          const scale = Math.min(1, THUMB_PX / Math.min(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#f7efe6';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) {
              URL.revokeObjectURL(url);
              resolve(URL.createObjectURL(blob));
            } else {
              resolve(url);
            }
          }, 'image/jpeg', 0.8);
        } catch (err) {
          resolve(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode'));
      };
      img.src = url;
    });
  }

  // ---------- Selección ----------

  async function validate(file, fingerprint) {
    if (pendingItems().some(i => i.fingerprint === fingerprint)) return 'duplicate';
    if (uploadedFingerprints.has(fingerprint)) return 'uploaded';
    if (pendingItems().length >= CONFIG.maxFiles) return 'count';
    if (file.size === 0) return 'empty';
    if (file.size > CONFIG.maxFileBytes) return 'size';
    const total = pendingItems().reduce((sum, i) => sum + i.size, 0);
    if (total + file.size > CONFIG.maxTotalBytes) return 'total';
    return null;
  }

  async function addFiles(files) {
    if (!files.length || busy) return;

    // Una selección nueva después de un envío deja fuera de la lista las
    // fotos que ya se guardaron.
    if (finished) clearUploaded();

    busy = 'validating';
    hideNotice();
    setStatus(files.length === 1 ? 'Revisando la foto…' : `Revisando ${files.length} fotos…`);
    render();

    const rejected = [];
    for (const file of files) {
      const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
      let reason = await validate(file, fingerprint);
      let type = null;
      let thumbUrl = null;
      if (!reason) {
        try {
          type = await sniffType(file);
          if (!type) reason = 'type';
        } catch (err) {
          reason = 'decode';
        }
      }
      if (!reason) {
        try {
          thumbUrl = await makeThumbnail(file);
        } catch (err) {
          reason = 'decode';
        }
      }
      if (reason) {
        rejected.push({ name: file.name, reason });
        continue;
      }
      const item = {
        id: nextId++,
        key: randomKey(),
        file,
        name: file.name,
        size: file.size,
        type,
        fingerprint,
        thumbUrl,
        status: 'ready',
        error: null,
        el: null
      };
      items.push(item);
      grid.appendChild(createItemEl(item));
    }

    busy = null;
    setStatus('');
    if (rejected.length) {
      showNotice(
        plural(rejected.length, 'Esta foto no se agregó:', 'Estas # fotos no se agregaron:'),
        rejected.map(r => `${r.name}: ${REJECT_REASONS[r.reason]}`)
      );
    }
    render();
  }

  function removeItem(item) {
    if (busy || item.status === 'done') return;
    const index = items.indexOf(item);
    URL.revokeObjectURL(item.thumbUrl);
    item.el.remove();
    items.splice(index, 1);
    finished = false;
    setStatus('');
    render();
    // El foco pasa a la foto siguiente (o a la anterior, o al botón
    // principal) para no perderse al usar teclado o lector de pantalla.
    const next = items.slice(index).concat(items.slice(0, index).reverse())
      .find(i => i.status !== 'done');
    (next ? next.el.querySelector('.photo-remove') : (uploadBtn.hidden ? pickBtn : uploadBtn)).focus();
  }

  function clearPending() {
    if (busy) return;
    pendingItems().forEach((item) => {
      URL.revokeObjectURL(item.thumbUrl);
      item.el.remove();
    });
    items = items.filter(i => i.status === 'done');
    finished = false;
    hideNotice();
    setStatus('');
    render();
    pickBtn.focus();
  }

  function clearUploaded() {
    items.filter(i => i.status === 'done').forEach((item) => {
      URL.revokeObjectURL(item.thumbUrl);
      item.el.remove();
    });
    items = pendingItems();
    finished = false;
    setStatus('');
  }

  // ---------- Carga ----------

  async function startUpload() {
    if (busy) return;
    const queue = sendableItems();
    if (!queue.length) return;

    busy = 'uploading';
    finished = false;
    hideNotice();
    queue.forEach((item) => { item.status = 'queued'; item.error = null; updateItemEl(item); });

    const total = queue.length;
    let completed = 0;
    const showProgress = () => {
      setStatus(`Subiendo fotos… ${completed} de ${total}. No cierres esta página.`);
      statusProgress.max = total;
      statusProgress.value = completed;
      statusProgress.hidden = false;
    };
    showProgress();
    render();

    const results = { done: 0, failed: 0, codes: {} };
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        item.status = 'uploading';
        updateItemEl(item);
        try {
          await uploadPhoto(item);
          item.status = 'done';
          uploadedFingerprints.add(item.fingerprint);
          results.done++;
        } catch (err) {
          const code = (err && err.code && UPLOAD_ERRORS[err.code]) ? err.code : 'unknown';
          item.status = 'failed';
          item.error = code;
          results.failed++;
          results.codes[code] = (results.codes[code] || 0) + 1;
        }
        completed++;
        updateItemEl(item);
        showProgress();
      }
    };
    const workers = Math.max(1, Math.min(CONFIG.concurrency, total));
    await Promise.all(Array.from({ length: workers }, worker));

    busy = null;
    finished = true;
    statusProgress.hidden = true;
    showSummary(results, total);
    render();
  }

  function showSummary({ done, failed, codes }, total) {
    if (!failed) {
      // Incluye las que ya se habían subido antes de un reintento.
      const saved = items.filter(i => i.status === 'done').length;
      setStatus(`¡Gracias! ${plural(saved, 'Tu foto se subió', 'Tus # fotos se subieron')} correctamente.`);
      return;
    }
    const mainCode = Object.keys(codes).sort((a, b) => codes[b] - codes[a])[0];
    const reason = UPLOAD_ERRORS[mainCode];
    if (!done) {
      setStatus(`${plural(failed, 'No se pudo subir la foto.', 'No se pudo subir ninguna de las # fotos.')} ${reason}`, true);
    } else {
      setStatus(`Se subieron ${done} de ${total} fotos; ${plural(failed, '1 no se pudo subir.', '# no se pudieron subir.')} ${reason}`, true);
    }
  }

  // ---------- Pintado ----------

  function setStatus(text, isError = false) {
    statusText.textContent = text;
    statusText.classList.toggle('is-error', isError);
    if (!text) statusProgress.hidden = true;
  }

  function showNotice(title, lines) {
    noticeTitle.textContent = title;
    noticeList.replaceChildren(...lines.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }));
    notice.hidden = false;
  }

  function hideNotice() {
    notice.hidden = true;
    noticeList.replaceChildren();
  }

  const BADGE_SVG =
    '<span class="icon icon--spinner"></span>' +
    '<svg class="icon icon--done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-width="1.6"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>' +
    '<svg class="icon icon--failed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10" stroke-width="1.6"/><path d="M12 7v6.5"/><path d="M12 17h.01"/></svg>';

  function createItemEl(item) {
    const li = document.createElement('li');
    li.className = 'photo-item';

    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    const img = document.createElement('img');
    img.src = item.thumbUrl;
    img.alt = '';
    const badge = document.createElement('span');
    badge.className = 'photo-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = BADGE_SVG;
    thumb.append(img, badge);

    const remove = document.createElement('button');
    remove.className = 'photo-remove';
    remove.type = 'button';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.setAttribute('aria-label', `Quitar ${item.name}`);
    remove.addEventListener('click', () => removeItem(item));

    const name = document.createElement('p');
    name.className = 'photo-name';
    name.textContent = item.name;
    name.title = item.name;

    const meta = document.createElement('p');
    meta.className = 'photo-meta';

    li.append(thumb, remove, name, meta);
    item.el = li;
    updateItemEl(item);
    return li;
  }

  function updateItemEl(item) {
    const li = item.el;
    if (!li) return;
    li.className = `photo-item is-${item.status}`;
    const label = item.status === 'failed' ? ITEM_ERRORS[item.error] : STATUS_LABELS[item.status];
    li.querySelector('.photo-meta').textContent = label ? `${formatSize(item.size)} · ${label}` : formatSize(item.size);
    const remove = li.querySelector('.photo-remove');
    remove.hidden = item.status === 'done' || busy === 'uploading';
    remove.disabled = Boolean(busy);
  }

  function render() {
    const sendable = sendableItems().length;
    const hasFailed = items.some(i => i.status === 'failed');

    content.classList.toggle('is-empty', items.length === 0);

    uploadBtn.hidden = sendable === 0;
    uploadBtn.textContent = hasFailed && finished
      ? plural(sendable, 'Reintentar la foto', 'Reintentar las # fotos')
      : plural(sendable, 'Subir 1 foto', 'Subir # fotos');

    pickBtn.hidden = sendable > 0 || busy === 'uploading';
    pickBtn.textContent = items.length ? 'Subir más fotos' : 'Elegir fotos';

    addMoreBtn.hidden = sendable === 0;
    clearBtn.hidden = sendable === 0;
    clearBtn.textContent = plural(sendable, 'Quitar la foto', 'Quitar todas');

    [uploadBtn, pickBtn, addMoreBtn, clearBtn].forEach((btn) => { btn.disabled = Boolean(busy); });
    items.forEach(updateItemEl);
  }

  // ---------- Eventos ----------

  function openPicker() {
    if (busy) return;
    fileInput.click();
  }

  pickBtn.addEventListener('click', openPicker);
  addMoreBtn.addEventListener('click', openPicker);
  uploadBtn.addEventListener('click', startUpload);
  clearBtn.addEventListener('click', clearPending);

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    // Se limpia para que volver a elegir la misma foto dispare "change".
    fileInput.value = '';
    addFiles(files);
  });

  window.addEventListener('beforeunload', (e) => {
    if (busy !== 'uploading') return;
    e.preventDefault();
    e.returnValue = '';
  });

  render();
})();
