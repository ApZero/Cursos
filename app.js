/* ==========================================================================
   Terreno — course & progress tracker
   Vanilla JS, no build step, no dependencies. All state lives in localStorage.
   ========================================================================== */

const STORAGE_KEYS = {
  courseList: 'terreno:courses',      // array of course ids
  course: (id) => `terreno:course:${id}`,      // full course JSON
  progress: (id) => `terreno:progress:${id}`,  // { completedBlocks: [], lastSaved, updatedAt }
};

const DEFAULT_COURSE_URL = 'courses/vermicompost-101.json';

let state = {
  currentCourseId: null,
};

/* ---------------------------- Utilities ---------------------------- */

function todayISO(){
  return new Date().toISOString();
}

function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Minimal markdown-ish renderer: **bold** -> <strong>, otherwise escape.
function renderInline(text){
  if (!text) return '';
  const escaped = escapeHTML(text);
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function toast(msg, ms=2600){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.classList.add('hidden'), ms);
}

function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

/* ---------------------------- Storage layer ---------------------------- */

function getCourseIds(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.courseList)) || []; }
  catch { return []; }
}

function saveCourseIds(ids){
  localStorage.setItem(STORAGE_KEYS.courseList, JSON.stringify(ids));
}

function getCourse(id){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.course(id))); }
  catch { return null; }
}

function saveCourse(course){
  localStorage.setItem(STORAGE_KEYS.course(course.id), JSON.stringify(course));
  const ids = getCourseIds();
  if (!ids.includes(course.id)){
    ids.push(course.id);
    saveCourseIds(ids);
  }
}

function getProgress(id){
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEYS.progress(id)));
    if (p) return p;
  } catch {}
  return { courseId: id, completedBlocks: [], lastSaved: null, updatedAt: null };
}

function saveProgress(progress){
  progress.lastSaved = todayISO();
  progress.updatedAt = todayISO();
  localStorage.setItem(STORAGE_KEYS.progress(progress.courseId), JSON.stringify(progress));
}

function deleteCourseEntirely(id){
  localStorage.removeItem(STORAGE_KEYS.course(id));
  localStorage.removeItem(STORAGE_KEYS.progress(id));
  saveCourseIds(getCourseIds().filter(x => x !== id));
}

/* ---------------------------- Import logic ---------------------------- */

function looksLikeCourse(obj){
  return obj && typeof obj === 'object' && Array.isArray(obj.blocks) && obj.id && obj.title;
}
function looksLikeProgress(obj){
  return obj && typeof obj === 'object' && obj.courseId && Array.isArray(obj.completedBlocks);
}
function looksLikeBundle(obj){
  return obj && typeof obj === 'object' && looksLikeCourse(obj.course) && obj.progress;
}

function handleImportedObject(obj, {silent=false} = {}){
  if (looksLikeBundle(obj)){
    saveCourse(obj.course);
    const prog = { courseId: obj.course.id, completedBlocks: obj.progress.completedBlocks || [], lastSaved: null, updatedAt: null };
    saveProgress(prog);
    if (!silent) toast(`Curso y progreso importados: ${obj.course.title}`);
    return { type:'bundle', id: obj.course.id };
  }
  if (looksLikeCourse(obj)){
    const existed = !!getCourse(obj.id);
    saveCourse(obj);
    if (!existed){
      saveProgress({ courseId: obj.id, completedBlocks: [], lastSaved: null, updatedAt: null });
    }
    if (!silent) toast(existed ? `Contenido actualizado: ${obj.title}` : `Curso importado: ${obj.title}`);
    return { type:'course', id: obj.id };
  }
  if (looksLikeProgress(obj)){
    if (!getCourse(obj.courseId)){
      if (!silent) toast('No se encontró el curso para este progreso. Importá primero el curso.');
      return null;
    }
    saveProgress({ courseId: obj.courseId, completedBlocks: obj.completedBlocks || [], lastSaved: null, updatedAt: null });
    if (!silent) toast('Progreso restaurado.');
    return { type:'progress', id: obj.courseId };
  }
  if (!silent) toast('El archivo no tiene un formato reconocido.');
  return null;
}

function importFromFile(file, cb){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      const result = handleImportedObject(obj);
      if (cb) cb(result);
    } catch (e){
      toast('No se pudo leer el archivo: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------------------------- Rendering: Library ---------------------------- */

function computeProgressStats(course, progress){
  const total = course.blocks.length;
  const done = course.blocks.filter(b => progress.completedBlocks.includes(b.id)).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  return { total, done, pct };
}

function renderLibrary(){
  const grid = document.getElementById('course-grid');
  const emptyState = document.getElementById('library-empty');
  const ids = getCourseIds();
  grid.innerHTML = '';

  if (ids.length === 0){
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  ids.forEach(id => {
    const course = getCourse(id);
    if (!course) return;
    const progress = getProgress(id);
    const { total, done, pct } = computeProgressStats(course, progress);

    const card = document.createElement('div');
    card.className = 'course-card';
    card.innerHTML = `
      <div class="course-card-top">
        <h3>${escapeHTML(course.title)}</h3>
        <span class="hours-badge">${course.totalHours ?? ''}h</span>
      </div>
      <p class="desc">${escapeHTML(course.subtitle || course.description || '')}</p>
      <div class="layer-progress"><div class="layer-progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-meta">
        <span class="mono">${done}/${total} bloques</span>
        <span class="mono progress-pct">${pct}%</span>
      </div>
    `;
    card.addEventListener('click', () => openCourse(id));
    grid.appendChild(card);
  });
}

/* ---------------------------- Rendering: Course view ---------------------------- */

let openBlockIds = new Set();

function openCourse(id){
  state.currentCourseId = id;
  openBlockIds = new Set();
  document.getElementById('view-library').classList.add('hidden');
  document.getElementById('view-course').classList.remove('hidden');
  renderCourse();
  window.scrollTo(0,0);
}

function closeCourse(){
  state.currentCourseId = null;
  document.getElementById('view-course').classList.add('hidden');
  document.getElementById('view-library').classList.remove('hidden');
  renderLibrary();
}

function renderCourse(){
  const course = getCourse(state.currentCourseId);
  if (!course){ closeCourse(); return; }
  const progress = getProgress(course.id);
  const { total, done, pct } = computeProgressStats(course, progress);

  document.getElementById('course-title').textContent = course.title;
  document.getElementById('course-subtitle').textContent = course.subtitle || '';
  document.getElementById('layer-progress-fill').style.width = pct + '%';
  document.getElementById('progress-count').textContent = `${done}/${total} bloques completados`;
  document.getElementById('progress-pct').textContent = `${pct}%`;

  const list = document.getElementById('blocks-list');
  list.innerHTML = '';
  course.blocks.forEach(block => {
    list.appendChild(renderBlockCard(course, block, progress));
  });

  // Final challenge
  const fcList = document.getElementById('final-challenge-list');
  fcList.innerHTML = '';
  if (course.finalChallenge && course.finalChallenge.length){
    document.getElementById('final-challenge').classList.remove('hidden');
    course.finalChallenge.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = renderInline(item);
      fcList.appendChild(li);
    });
  } else {
    document.getElementById('final-challenge').classList.add('hidden');
  }

  // Resources
  const booksWrap = document.getElementById('resources-books');
  const chanWrap = document.getElementById('resources-channels');
  booksWrap.innerHTML = '';
  chanWrap.innerHTML = '';
  const res = course.resources || {};
  if (res.books && res.books.length){
    booksWrap.innerHTML = `<div class="resource-group-title">Libros</div>` +
      res.books.map(b => `<div class="resource-item"><strong>${escapeHTML(b.title)}</strong> <span class="r-author">— ${escapeHTML(b.author||'')}</span>${b.note ? `<span class="r-note">${escapeHTML(b.note)}</span>` : ''}</div>`).join('');
  }
  if (res.channels && res.channels.length){
    chanWrap.innerHTML = `<div class="resource-group-title">Canales de YouTube</div>` +
      res.channels.map(c => `<div class="resource-item">${c.url ? `<a href="${escapeHTML(c.url)}" target="_blank" rel="noopener">${escapeHTML(c.name)}</a>` : escapeHTML(c.name)}</div>`).join('');
  }
  document.getElementById('course-resources').classList.toggle('hidden', !(res.books?.length || res.channels?.length));
}

function renderBlockCard(course, block, progress){
  const isComplete = progress.completedBlocks.includes(block.id);
  const isOpen = openBlockIds.has(block.id);

  const card = document.createElement('div');
  card.className = 'block-card' + (isComplete ? ' is-complete' : '') + (isOpen ? ' is-open' : '');
  card.dataset.blockId = block.id;

  const header = document.createElement('div');
  header.className = 'block-header';
  header.innerHTML = `
    <button class="block-check ${isComplete ? 'checked' : ''}" type="button" aria-label="Marcar bloque completo">${isComplete ? '✓' : ''}</button>
    <div class="block-header-text">
      <div class="block-header-title">
        <span class="block-number">BLOQUE ${block.number}</span>
        <h3>${escapeHTML(block.title)}</h3>
        <span class="block-hours">${block.hours}h</span>
      </div>
      <p class="block-goal">${escapeHTML(block.goal || '')}</p>
    </div>
    <span class="block-chevron">▸</span>
  `;

  const checkBtn = header.querySelector('.block-check');
  checkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBlockComplete(course.id, block.id);
  });
  header.addEventListener('click', () => {
    if (openBlockIds.has(block.id)) openBlockIds.delete(block.id);
    else openBlockIds.add(block.id);
    renderCourse();
  });

  const body = document.createElement('div');
  body.className = 'block-body';
  const inner = document.createElement('div');
  inner.className = 'block-body-inner';
  inner.appendChild(renderBlockBody(block));
  body.appendChild(inner);

  // Only render (and measure) inner content height when open, to keep the collapse smooth.
  if (isOpen){
    // set to scrollHeight after insertion
    requestAnimationFrame(() => { body.style.maxHeight = inner.scrollHeight + 40 + 'px'; });
  } else {
    body.style.maxHeight = '0px';
  }

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function renderBlockBody(block){
  const wrap = document.createElement('div');

  if (block.visual && VISUALS[block.visual]){
    const vwrap = document.createElement('div');
    vwrap.className = 'block-visual';
    vwrap.innerHTML = VISUALS[block.visual];
    wrap.appendChild(vwrap);
  }

  if (block.learn && block.learn.length){
    const learnWrap = document.createElement('div');
    learnWrap.className = 'learn-list';
    block.learn.forEach(item => {
      const li = document.createElement('div');
      li.className = 'learn-item';
      li.innerHTML = `<h4>${escapeHTML(item.term)}</h4><p>${renderInline(item.body)}</p>`;
      learnWrap.appendChild(li);
    });
    wrap.appendChild(learnWrap);
  }

  if (block.resourceNote){
    const note = document.createElement('p');
    note.className = 'resource-note';
    note.textContent = block.resourceNote;
    wrap.appendChild(note);
  }

  if (block.videos && block.videos.length){
    const vidsWrap = document.createElement('div');
    vidsWrap.className = 'videos-wrap';
    block.videos.forEach(v => vidsWrap.appendChild(renderVideoFacade(v)));
    wrap.appendChild(vidsWrap);
  }

  if (block.project){
    const p = document.createElement('div');
    p.className = 'project-box';
    p.innerHTML = `<span class="label">Proyecto</span>${renderInline(block.project)}`;
    wrap.appendChild(p);
  }

  if (block.check){
    const c = document.createElement('div');
    c.className = 'check-box';
    c.innerHTML = `<span class="label">Chequeo de 15 minutos</span>${renderInline(block.check)}`;
    wrap.appendChild(c);
  }

  return wrap;
}

function renderVideoFacade(video){
  const box = document.createElement('div');
  const facade = document.createElement('div');
  facade.className = 'video-facade';
  facade.innerHTML = `
    <img loading="lazy" src="https://img.youtube.com/vi/${encodeURIComponent(video.youtubeId)}/hqdefault.jpg" alt="${escapeHTML(video.title)}">
    <div class="video-play"><span>▶</span></div>
  `;
  facade.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.className = 'video-embed-frame';
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.youtubeId)}?autoplay=1`;
    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    iframe.setAttribute('allowfullscreen', '');
    facade.replaceWith(iframe);
  }, { once: true });
  const caption = document.createElement('p');
  caption.className = 'video-title';
  caption.textContent = video.title;
  box.appendChild(facade);
  box.appendChild(caption);
  return box;
}

function toggleBlockComplete(courseId, blockId){
  const progress = getProgress(courseId);
  const idx = progress.completedBlocks.indexOf(blockId);
  if (idx >= 0) progress.completedBlocks.splice(idx, 1);
  else progress.completedBlocks.push(blockId);
  saveProgress(progress);
  renderCourse();
}

/* ---------------------------- Visual library (inline SVGs) ---------------------------- */

const VISUALS = {
  wormAnatomy: `
  <svg viewBox="0 0 320 120" width="100%" style="max-width:340px">
    <path d="M20 70 Q 60 30 100 70 T 180 70 T 260 70" fill="none" stroke="#C1613C" stroke-width="16" stroke-linecap="round"/>
    <path d="M20 70 Q 60 30 100 70 T 180 70 T 260 70" fill="none" stroke="#A34F30" stroke-width="16" stroke-linecap="round" stroke-dasharray="1 14" />
    <rect x="150" y="58" width="46" height="24" rx="12" fill="#D9A441" opacity="0.85"/>
    <circle cx="292" cy="70" r="9" fill="#6B7A4F"/>
    <text x="173" y="105" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">clitelo</text>
    <text x="292" y="98" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cabeza</text>
    <text x="30" y="98" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cola</text>
  </svg>`,

  binLayers: `
  <svg viewBox="0 0 260 160" width="100%" style="max-width:300px">
    <rect x="20" y="20" width="220" height="120" rx="8" fill="none" stroke="#3A2E22" stroke-width="3"/>
    <rect x="24" y="106" width="212" height="30" fill="#8A6A46" opacity="0.55"/>
    <rect x="24" y="76" width="212" height="30" fill="#B7A05F" opacity="0.6"/>
    <rect x="24" y="46" width="212" height="30" fill="#D9C48A" opacity="0.7"/>
    <circle cx="70" cy="90" r="3" fill="#C1613C"/><circle cx="120" cy="118" r="3" fill="#C1613C"/>
    <circle cx="180" cy="95" r="3" fill="#C1613C"/><circle cx="90" cy="60" r="3" fill="#C1613C"/>
    <text x="130" y="152" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cama húmeda + comida enterrada + zona de lombrices</text>
  </svg>`,

  tempGauge: `
  <svg viewBox="0 0 300 90" width="100%" style="max-width:320px">
    <rect x="10" y="30" width="280" height="18" rx="9" fill="url(#g1)"/>
    <defs><linearGradient id="g1" x1="0" x2="1">
      <stop offset="0%" stop-color="#7FA0C9"/>
      <stop offset="30%" stop-color="#6B7A4F"/>
      <stop offset="55%" stop-color="#D9A441"/>
      <stop offset="78%" stop-color="#C1613C"/>
      <stop offset="100%" stop-color="#8B2E20"/>
    </linearGradient></defs>
    <text x="10" y="70" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">frío</text>
    <text x="90" y="70" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">12–25°C ideal</text>
    <text x="185" y="70" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">30°C: escapan</text>
    <text x="250" y="70" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">35°C+: peligro</text>
    <text x="150" y="22" font-size="9" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">temperatura de la cama de lombrices</text>
  </svg>`,

  cnRatio: `
  <svg viewBox="0 0 260 110" width="100%" style="max-width:300px">
    <line x1="130" y1="20" x2="130" y2="45" stroke="#3A2E22" stroke-width="3"/>
    <line x1="40" y1="45" x2="220" y2="45" stroke="#3A2E22" stroke-width="3"/>
    <line x1="40" y1="45" x2="40" y2="75" stroke="#6B7A4F" stroke-width="2"/>
    <line x1="220" y1="45" x2="220" y2="65" stroke="#C1613C" stroke-width="2"/>
    <rect x="10" y="75" width="60" height="20" rx="4" fill="#6B7A4F"/>
    <rect x="190" y="65" width="60" height="20" rx="4" fill="#C1613C"/>
    <text x="40" y="108" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cama (carbono)</text>
    <text x="220" y="98" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">comida (nitrógeno)</text>
  </svg>`,

  lifecycle: `
  <svg viewBox="0 0 240 240" width="100%" style="max-width:240px">
    <circle cx="120" cy="120" r="85" fill="none" stroke="#D9CBAE" stroke-width="2" stroke-dasharray="4 5"/>
    <circle cx="120" cy="35" r="16" fill="#D9A441"/><text x="120" y="12" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">capullo</text>
    <circle cx="205" cy="120" r="16" fill="#C1613C"/><text x="205" y="146" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cría</text>
    <circle cx="120" cy="205" r="16" fill="#6B7A4F"/><text x="120" y="230" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">juvenil</text>
    <circle cx="35" cy="120" r="16" fill="#A34F30"/><text x="35" y="146" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">adulto</text>
  </svg>`,

  harvestMethods: `
  <svg viewBox="0 0 300 130" width="100%" style="max-width:320px">
    <polygon points="70,20 30,110 110,110" fill="#D9A441" opacity="0.5"/>
    <circle cx="70" cy="15" r="10" fill="#FFF3D6" stroke="#D9A441" stroke-width="2"/>
    <text x="70" y="126" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">método de luz</text>
    <rect x="180" y="40" width="100" height="18" rx="3" fill="#B7A05F"/>
    <rect x="180" y="62" width="100" height="18" rx="3" fill="#D9C48A"/>
    <rect x="205" y="20" width="50" height="18" rx="3" fill="#8FAE72"/>
    <text x="230" y="126" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">migración por bandejas</text>
  </svg>`,
};

/* ---------------------------- Event wiring ---------------------------- */

function wireEvents(){
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input-course').click());
  document.getElementById('btn-import-empty').addEventListener('click', () => document.getElementById('file-input-course').click());
  document.getElementById('file-input-course').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importFromFile(file, (result) => {
      if (state.currentCourseId && result && result.id === state.currentCourseId){
        renderCourse();
      } else {
        renderLibrary();
      }
    });
    e.target.value = '';
  });

  document.getElementById('btn-back').addEventListener('click', closeCourse);

  document.getElementById('btn-course-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('course-menu').classList.toggle('hidden');
  });
  document.addEventListener('click', () => document.getElementById('course-menu').classList.add('hidden'));

  document.getElementById('course-menu').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    e.stopPropagation();
    const id = state.currentCourseId;
    const course = getCourse(id);
    const progress = getProgress(id);

    if (action === 'export-progress'){
      downloadJSON({ courseId: id, completedBlocks: progress.completedBlocks, exportedAt: todayISO() }, `progreso-${id}.json`);
    } else if (action === 'export-bundle'){
      downloadJSON({ course, progress: { completedBlocks: progress.completedBlocks } }, `curso-y-progreso-${id}.json`);
    } else if (action === 'reimport-content'){
      document.getElementById('file-input-course').click();
    } else if (action === 'delete-course'){
      if (confirm(`¿Eliminar "${course.title}" y todo su progreso? Esta acción no se puede deshacer.`)){
        deleteCourseEntirely(id);
        toast('Curso eliminado.');
        closeCourse();
      }
    }
    document.getElementById('course-menu').classList.add('hidden');
  });

  document.getElementById('btn-backup').addEventListener('click', () => {
    const ids = getCourseIds();
    const bundle = ids.map(id => ({ course: getCourse(id), progress: { completedBlocks: getProgress(id).completedBlocks } }));
    downloadJSON({ type: 'terreno-full-backup', courses: bundle, exportedAt: todayISO() }, `terreno-backup-${new Date().toISOString().slice(0,10)}.json`);
  });

  document.getElementById('btn-restore').addEventListener('click', () => document.getElementById('file-input-restore').click());
  document.getElementById('file-input-restore').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) { return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (obj.type === 'terreno-full-backup' && Array.isArray(obj.courses)){
          obj.courses.forEach(entry => handleImportedObject({ course: entry.course, progress: entry.progress }, {silent:true}));
          toast(`Copia de seguridad restaurada: ${obj.courses.length} curso(s).`);
          renderLibrary();
        } else {
          handleImportedObject(obj);
          renderLibrary();
        }
      } catch(err){ toast('No se pudo leer la copia de seguridad: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

/* ---------------------------- Boot ---------------------------- */

async function maybeSeedDefaultCourse(){
  if (getCourseIds().length > 0) return;
  try {
    const res = await fetch(DEFAULT_COURSE_URL);
    if (!res.ok) return;
    const course = await res.json();
    if (looksLikeCourse(course)){
      handleImportedObject(course, {silent:true});
    }
  } catch { /* offline on first load with no cache yet — user can import manually */ }
}

async function init(){
  wireEvents();
  await maybeSeedDefaultCourse();
  renderLibrary();

  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

init();
