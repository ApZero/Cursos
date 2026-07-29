/* ==========================================================================
   Terreno — course & progress tracker
   Vanilla JS, no build step, no dependencies. All state lives in localStorage.
   ========================================================================== */

const STORAGE_KEYS = {
  courseList: 'terreno:courses',      // array of course ids
  course: (id) => `terreno:course:${id}`,      // full course JSON
  progress: (id) => `terreno:progress:${id}`,  // { completedBlocks: [], lastSaved, updatedAt }
};

const DEFAULT_COURSE_URLS = [
  'courses/vermicompost-101.json',
  'courses/veggie-growing-101.json',
  'courses/meliponicultura-101.json',
  'courses/indoor-plants-101.json',
  'courses/gluten-free-bread-101.json',
  'courses/embarazo-101.json',
  'courses/autosuficiencia-chaco-101.json',
];

let state = {
  currentCourseId: null,
  currentCategory: null,
  editing: false,
  editDraft: null,
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

// Like escapeHTML, but also safe to place inside a double-quoted HTML attribute
// (escapeHTML alone doesn't encode quote characters, since they're not special in text nodes).
function escapeAttr(str){
  return escapeHTML(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

/* ---------------------------- Theme (dark mode) ---------------------------- */

const THEME_KEY = 'terreno:theme';

function getStoredTheme(){
  try { return localStorage.getItem(THEME_KEY) || 'light'; }
  catch { return 'light'; }
}

function applyTheme(theme){
  document.body.classList.toggle('dark', theme === 'dark');
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme(){
  const next = getStoredTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
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
  return { courseId: id, completedBlocks: [], lastSaved: null, updatedAt: null, lastOpenedAt: null };
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

function getCourseCategory(course){
  return (course && course.category) ? course.category : 'General';
}

function buildCourseCard(id){
  const course = getCourse(id);
  if (!course) return null;
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
  return card;
}

function renderHome(){
  const emptyState = document.getElementById('library-empty');
  const homeContent = document.getElementById('home-content');
  const ids = getCourseIds();

  if (ids.length === 0){
    emptyState.classList.remove('hidden');
    homeContent.classList.add('hidden');
    return;
  }
  emptyState.classList.add('hidden');
  homeContent.classList.remove('hidden');

  // Recientes: last 3 opened, most recent first
  const recentGrid = document.getElementById('recent-grid');
  const recentSection = document.getElementById('recent-section');
  recentGrid.innerHTML = '';
  const recentIds = ids
    .map(id => ({ id, lastOpenedAt: getProgress(id).lastOpenedAt }))
    .filter(x => x.lastOpenedAt)
    .sort((a,b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))
    .slice(0, 3)
    .map(x => x.id);

  if (recentIds.length){
    recentSection.classList.remove('hidden');
    recentIds.forEach(id => {
      const card = buildCourseCard(id);
      if (card) recentGrid.appendChild(card);
    });
  } else {
    recentSection.classList.add('hidden');
  }

  // Categorías: tiles with counts
  const catWrap = document.getElementById('category-tiles');
  const catSection = document.getElementById('category-section');
  catWrap.innerHTML = '';
  const byCategory = new Map();
  ids.forEach(id => {
    const course = getCourse(id);
    if (!course) return;
    const cat = getCourseCategory(course);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(id);
  });

  if (byCategory.size){
    catSection.classList.remove('hidden');
    Array.from(byCategory.keys()).sort((a,b) => a.localeCompare(b, 'es')).forEach(cat => {
      const courseIds = byCategory.get(cat);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'category-tile';
      tile.innerHTML = `
        <span class="category-tile-name">${escapeHTML(cat)}</span>
        <span class="category-tile-count mono">${courseIds.length} curso${courseIds.length === 1 ? '' : 's'}</span>
      `;
      tile.addEventListener('click', () => openCategory(cat));
      catWrap.appendChild(tile);
    });
  } else {
    catSection.classList.add('hidden');
  }
}

function openCategory(categoryName){
  state.currentCategory = categoryName;
  document.getElementById('view-library').classList.add('hidden');
  document.getElementById('view-course').classList.add('hidden');
  document.getElementById('view-category').classList.remove('hidden');
  renderCategoryView();
  window.scrollTo(0,0);
}

function closeCategory(){
  state.currentCategory = null;
  document.getElementById('view-category').classList.add('hidden');
  document.getElementById('view-library').classList.remove('hidden');
  renderHome();
}

function renderCategoryView(){
  const cat = state.currentCategory;
  const ids = getCourseIds().filter(id => {
    const course = getCourse(id);
    return course && getCourseCategory(course) === cat;
  });
  document.getElementById('category-title').textContent = cat;
  document.getElementById('category-count').textContent = `${ids.length} curso${ids.length === 1 ? '' : 's'}`;
  const grid = document.getElementById('category-course-grid');
  grid.innerHTML = '';
  ids.forEach(id => {
    const card = buildCourseCard(id);
    if (card) grid.appendChild(card);
  });
}

/* ---------------------------- Rendering: Course view ---------------------------- */

let openBlockId = null;

function openCourse(id){
  state.currentCourseId = id;
  openBlockId = null;
  const progress = getProgress(id);
  progress.lastOpenedAt = todayISO();
  saveProgress(progress);
  document.getElementById('view-library').classList.add('hidden');
  document.getElementById('view-category').classList.add('hidden');
  document.getElementById('view-course').classList.remove('hidden');
  exitEditor({ silent: true });
  renderCourse();
  window.scrollTo(0,0);
}

function closeCourse(){
  state.currentCourseId = null;
  document.getElementById('view-course').classList.add('hidden');
  if (state.currentCategory){
    document.getElementById('view-category').classList.remove('hidden');
    renderCategoryView();
  } else {
    document.getElementById('view-library').classList.remove('hidden');
    renderHome();
  }
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
  const isOpen = openBlockId === block.id;

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
    // Accordion: opening a block closes whichever other block was open.
    openBlockId = (openBlockId === block.id) ? null : block.id;
    renderCourse();
    if (openBlockId === block.id){
      requestAnimationFrame(() => {
        const el = document.querySelector(`.block-card[data-block-id="${CSS.escape(block.id)}"]`);
        if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    }
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

/* ---------------------------- Course / block editor ---------------------------- */

function enterEditor(){
  const course = getCourse(state.currentCourseId);
  if (!course) return;
  state.editing = true;
  state.editDraft = JSON.parse(JSON.stringify(course)); // deep clone as a scratch draft
  document.getElementById('blocks-list').classList.add('hidden');
  document.getElementById('final-challenge').classList.add('hidden');
  document.getElementById('course-resources').classList.add('hidden');
  document.getElementById('course-progress-panel').classList.add('hidden');
  document.getElementById('course-editor').classList.remove('hidden');
  renderEditorForm();
}

function exitEditor({ silent } = {}){
  state.editing = false;
  state.editDraft = null;
  const editorEl = document.getElementById('course-editor');
  if (editorEl) editorEl.classList.add('hidden');
  const blocksEl = document.getElementById('blocks-list');
  if (blocksEl) blocksEl.classList.remove('hidden');
  const fc = document.getElementById('final-challenge');
  if (fc) fc.classList.remove('hidden');
  const res = document.getElementById('course-resources');
  if (res) res.classList.remove('hidden');
  const panel = document.getElementById('course-progress-panel');
  if (panel) panel.classList.remove('hidden');
  if (!silent) renderCourse();
}

function existingCategories(){
  const cats = new Set();
  getCourseIds().forEach(id => {
    const c = getCourse(id);
    if (c) cats.add(getCourseCategory(c));
  });
  return Array.from(cats).sort((a,b) => a.localeCompare(b, 'es'));
}

function renderEditorForm(){
  const wrap = document.getElementById('course-editor');
  const d = state.editDraft;
  wrap.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'editor-section';
  const catOptions = existingCategories();
  head.innerHTML = `
    <label class="editor-label">Título del curso</label>
    <input type="text" class="editor-input" id="edit-title" value="${escapeAttr(d.title || '')}">
    <label class="editor-label">Subtítulo</label>
    <input type="text" class="editor-input" id="edit-subtitle" value="${escapeAttr(d.subtitle || '')}">
    <label class="editor-label">Descripción</label>
    <textarea class="editor-textarea" id="edit-description" rows="3">${escapeHTML(d.description || '')}</textarea>
    <label class="editor-label">Categoría</label>
    <input type="text" class="editor-input" id="edit-category" list="editor-category-list" value="${escapeAttr(getCourseCategory(d))}">
    <datalist id="editor-category-list">
      ${catOptions.map(c => `<option value="${escapeAttr(c)}"></option>`).join('')}
    </datalist>
    <label class="editor-label">Horas totales</label>
    <input type="number" class="editor-input" id="edit-hours" value="${d.totalHours ?? ''}" min="0">
  `;
  wrap.appendChild(head);

  head.querySelector('#edit-title').addEventListener('input', (e) => d.title = e.target.value);
  head.querySelector('#edit-subtitle').addEventListener('input', (e) => d.subtitle = e.target.value);
  head.querySelector('#edit-description').addEventListener('input', (e) => d.description = e.target.value);
  head.querySelector('#edit-category').addEventListener('input', (e) => d.category = e.target.value);
  head.querySelector('#edit-hours').addEventListener('input', (e) => d.totalHours = e.target.value ? Number(e.target.value) : null);

  const blocksHeading = document.createElement('div');
  blocksHeading.className = 'editor-blocks-heading';
  blocksHeading.innerHTML = `<h2>Bloques</h2>`;
  wrap.appendChild(blocksHeading);

  d.blocks.forEach((block, bIdx) => {
    wrap.appendChild(renderEditorBlock(d, block, bIdx));
  });

  const addBlockBtn = document.createElement('button');
  addBlockBtn.type = 'button';
  addBlockBtn.className = 'btn btn-outline editor-add-block';
  addBlockBtn.textContent = '+ Agregar bloque';
  addBlockBtn.addEventListener('click', () => {
    const nextNumber = d.blocks.length + 1;
    d.blocks.push({
      id: 'b' + Date.now(),
      number: nextNumber,
      title: 'Bloque nuevo',
      hours: 2,
      goal: '',
      learn: [],
      videos: [],
      project: '',
      check: ''
    });
    renderEditorForm();
  });
  wrap.appendChild(addBlockBtn);

  const actions = document.createElement('div');
  actions.className = 'editor-actions';
  actions.innerHTML = `
    <button type="button" class="btn btn-outline" id="edit-cancel">Cancelar</button>
    <button type="button" class="btn btn-accent" id="edit-save">Guardar cambios</button>
  `;
  wrap.appendChild(actions);
  actions.querySelector('#edit-cancel').addEventListener('click', () => exitEditor());
  actions.querySelector('#edit-save').addEventListener('click', saveEditorChanges);
}

function renderEditorBlock(draft, block, bIdx){
  const box = document.createElement('div');
  box.className = 'editor-block';

  const header = document.createElement('div');
  header.className = 'editor-block-header';
  header.innerHTML = `<span class="block-number">BLOQUE ${bIdx + 1}</span>`;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-link danger';
  removeBtn.textContent = 'Eliminar bloque';
  removeBtn.addEventListener('click', () => {
    if (confirm('¿Eliminar este bloque del curso?')){
      draft.blocks.splice(bIdx, 1);
      renderEditorForm();
    }
  });
  header.appendChild(removeBtn);
  box.appendChild(header);

  const fields = document.createElement('div');
  fields.innerHTML = `
    <label class="editor-label">Título del bloque</label>
    <input type="text" class="editor-input" data-f="title" value="${escapeAttr(block.title || '')}">
    <label class="editor-label">Horas</label>
    <input type="number" class="editor-input editor-input-narrow" data-f="hours" value="${block.hours ?? ''}" min="0">
    <label class="editor-label">Objetivo</label>
    <textarea class="editor-textarea" data-f="goal" rows="2">${escapeHTML(block.goal || '')}</textarea>
  `;
  box.appendChild(fields);
  fields.querySelector('[data-f="title"]').addEventListener('input', (e) => block.title = e.target.value);
  fields.querySelector('[data-f="hours"]').addEventListener('input', (e) => block.hours = e.target.value ? Number(e.target.value) : null);
  fields.querySelector('[data-f="goal"]').addEventListener('input', (e) => block.goal = e.target.value);

  const learnWrap = document.createElement('div');
  learnWrap.className = 'editor-learn-wrap';
  learnWrap.innerHTML = `<label class="editor-label">Conceptos (término + texto)</label>`;
  if (!block.learn) block.learn = [];
  block.learn.forEach((item, lIdx) => {
    const row = document.createElement('div');
    row.className = 'editor-learn-item';
    row.innerHTML = `
      <input type="text" class="editor-input" data-lf="term" placeholder="Término" value="${escapeAttr(item.term || '')}">
      <textarea class="editor-textarea" data-lf="body" rows="2" placeholder="Texto (usá **negrita** para resaltar)">${escapeHTML(item.body || '')}</textarea>
      <button type="button" class="btn-link danger editor-remove-learn">Quitar</button>
    `;
    row.querySelector('[data-lf="term"]').addEventListener('input', (e) => item.term = e.target.value);
    row.querySelector('[data-lf="body"]').addEventListener('input', (e) => item.body = e.target.value);
    row.querySelector('.editor-remove-learn').addEventListener('click', () => {
      block.learn.splice(lIdx, 1);
      renderEditorForm();
    });
    learnWrap.appendChild(row);
  });
  const addLearnBtn = document.createElement('button');
  addLearnBtn.type = 'button';
  addLearnBtn.className = 'btn-link';
  addLearnBtn.textContent = '+ Agregar concepto';
  addLearnBtn.addEventListener('click', () => {
    block.learn.push({ term: '', body: '' });
    renderEditorForm();
  });
  learnWrap.appendChild(addLearnBtn);
  box.appendChild(learnWrap);

  const tail = document.createElement('div');
  tail.innerHTML = `
    <label class="editor-label">Proyecto</label>
    <textarea class="editor-textarea" data-f="project" rows="2">${escapeHTML(block.project || '')}</textarea>
    <label class="editor-label">Chequeo de 15 minutos</label>
    <textarea class="editor-textarea" data-f="check" rows="2">${escapeHTML(block.check || '')}</textarea>
  `;
  box.appendChild(tail);
  tail.querySelector('[data-f="project"]').addEventListener('input', (e) => block.project = e.target.value);
  tail.querySelector('[data-f="check"]').addEventListener('input', (e) => block.check = e.target.value);

  return box;
}

function saveEditorChanges(){
  const d = state.editDraft;
  if (!d.title || !d.title.trim()){
    toast('El curso necesita un título.');
    return;
  }
  // Renumber blocks to match their current order
  d.blocks.forEach((b, i) => { b.number = i + 1; });
  saveCourse(d);
  toast('Cambios guardados.');
  exitEditor({ silent: true });
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

  soilTexture: `
  <svg viewBox="0 0 260 130" width="100%" style="max-width:300px">
    <polygon points="130,15 20,110 240,110" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <text x="130" y="10" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">arcilla</text>
    <text x="10" y="122" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">arena</text>
    <text x="250" y="122" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">limo</text>
    <circle cx="130" cy="78" r="20" fill="#C1613C" opacity="0.75"/>
    <text x="130" y="82" font-size="8" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">franco</text>
  </svg>`,

  sunHours: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <circle cx="40" cy="30" r="14" fill="#D9A441"/>
    <line x1="40" y1="30" x2="40" y2="80" stroke="#D9CBAE" stroke-width="2" stroke-dasharray="3 3"/>
    <rect x="20" y="80" width="220" height="10" fill="#8A6A46" opacity="0.5"/>
    <rect x="30" y="70" width="14" height="10" fill="#6B7A4F"/>
    <rect x="90" y="74" width="14" height="6" fill="#6B7A4F"/>
    <rect x="150" y="66" width="14" height="14" fill="#C1613C"/>
    <text x="150" y="60" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">6-8h sol</text>
    <text x="90" y="66" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">media sombra</text>
  </svg>`,

  seedStages: `
  <svg viewBox="0 0 280 90" width="100%" style="max-width:300px">
    <circle cx="30" cy="60" r="8" fill="#8A6A46"/>
    <path d="M70 70 L70 50 M70 50 q -8 -10 -16 -4" stroke="#6B7A4F" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M130 72 L130 40 M130 45 q -10 -8 -18 -2 M130 50 q 10 -8 18 -2" stroke="#6B7A4F" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M200 74 L200 30 M200 35 q -12 -10 -22 -2 M200 42 q 12 -10 22 -2 M200 50 q -12 -8 -20 0" stroke="#4F7942" stroke-width="3" fill="none" stroke-linecap="round"/>
    <text x="30" y="86" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">semilla</text>
    <text x="70" y="86" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">germinación</text>
    <text x="130" y="86" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">plantín</text>
    <text x="200" y="86" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">endurecido</text>
  </svg>`,

  wateringDiagram: `
  <svg viewBox="0 0 260 110" width="100%" style="max-width:280px">
    <ellipse cx="130" cy="95" rx="110" ry="10" fill="#8A6A46" opacity="0.4"/>
    <path d="M130 20 L130 70" stroke="#4F7942" stroke-width="4" stroke-linecap="round"/>
    <path d="M130 40 q -18 0 -22 20 M130 55 q 18 0 22 15" stroke="#4F7942" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M110 30 q10 15 5 30" stroke="#7FA0C9" stroke-width="2" fill="none"/>
    <path d="M150 25 q -6 18 -3 35" stroke="#7FA0C9" stroke-width="2" fill="none"/>
    <path d="M130 75 q0 15 0 25" stroke="#7FA0C9" stroke-width="3" fill="none" stroke-dasharray="2 3"/>
    <text x="130" y="108" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">riego profundo → raíces profundas</text>
  </svg>`,

  npkDiagram: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <circle cx="50" cy="50" r="34" fill="#6B7A4F" opacity="0.85"/>
    <text x="50" y="55" font-size="16" text-anchor="middle" fill="#fff" font-family="JetBrains Mono, monospace">N</text>
    <circle cx="130" cy="50" r="34" fill="#D9A441" opacity="0.9"/>
    <text x="130" y="55" font-size="16" text-anchor="middle" fill="#3A2E22" font-family="JetBrains Mono, monospace">P</text>
    <circle cx="210" cy="50" r="34" fill="#C1613C" opacity="0.9"/>
    <text x="210" y="55" font-size="16" text-anchor="middle" fill="#fff" font-family="JetBrains Mono, monospace">K</text>
    <text x="50" y="95" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">hojas</text>
    <text x="130" y="95" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">raíz/flor</text>
    <text x="210" y="95" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">vigor</text>
  </svg>`,

  familyWheel: `
  <svg viewBox="0 0 240 240" width="100%" style="max-width:240px">
    <circle cx="120" cy="120" r="90" fill="none" stroke="#D9CBAE" stroke-width="2"/>
    <circle cx="120" cy="35" r="18" fill="#C1613C"/><text x="120" y="10" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">solanáceas</text>
    <circle cx="197" cy="80" r="18" fill="#D9A441"/><text x="225" y="80" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cucurbitáceas</text>
    <circle cx="197" cy="160" r="18" fill="#6B7A4F"/><text x="225" y="185" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">fabáceas</text>
    <circle cx="120" cy="205" r="18" fill="#4F7942"/><text x="120" y="232" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">brasicáceas</text>
    <circle cx="43" cy="160" r="18" fill="#A34F30"/><text x="15" y="185" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">apiáceas</text>
    <circle cx="43" cy="80" r="18" fill="#8FAE72"/><text x="15" y="80" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">aliáceas</text>
  </svg>`,

  ipmPyramid: `
  <svg viewBox="0 0 240 120" width="100%" style="max-width:260px">
    <polygon points="120,10 220,110 20,110" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <line x1="60" y1="75" x2="180" y2="75" stroke="#3A2E22" stroke-width="1.5"/>
    <line x1="90" y1="42" x2="150" y2="42" stroke="#3A2E22" stroke-width="1.5"/>
    <text x="120" y="30" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">monitorear</text>
    <text x="120" y="62" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">barrera / manual</text>
    <text x="120" y="96" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">control orgánico dirigido</text>
  </svg>`,

  vegHeatGauge: `
  <svg viewBox="0 0 300 90" width="100%" style="max-width:320px">
    <rect x="10" y="30" width="280" height="18" rx="9" fill="url(#g2)"/>
    <defs><linearGradient id="g2" x1="0" x2="1">
      <stop offset="0%" stop-color="#6B7A4F"/>
      <stop offset="45%" stop-color="#D9A441"/>
      <stop offset="72%" stop-color="#C1613C"/>
      <stop offset="100%" stop-color="#8B2E20"/>
    </linearGradient></defs>
    <text x="10" y="70" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">templado</text>
    <text x="150" y="70" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">32°C: estrés (3+ días)</text>
    <text x="280" y="70" font-size="9" text-anchor="end" fill="#3A2E22" font-family="Inter, sans-serif">35°C+: daño (5+ días)</text>
    <text x="150" y="22" font-size="9" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">temperatura del aire — hortalizas</text>
  </svg>`,

  beeCompare: `
  <svg viewBox="0 0 280 120" width="100%" style="max-width:300px">
    <ellipse cx="80" cy="60" rx="46" ry="26" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <path d="M50 55 q30 -14 60 0" stroke="#D9A441" stroke-width="6" fill="none" stroke-linecap="round"/>
    <text x="80" y="100" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">meliponini — sin aguijón</text>
    <ellipse cx="210" cy="60" rx="30" ry="18" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <path d="M235 60 l14 0" stroke="#C1613C" stroke-width="3" stroke-linecap="round"/>
    <text x="210" y="100" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">apis — con aguijón</text>
  </svg>`,

  casteDiagram: `
  <svg viewBox="0 0 260 110" width="100%" style="max-width:280px">
    <ellipse cx="50" cy="55" rx="28" ry="34" fill="#C1613C" opacity="0.85"/>
    <text x="50" y="59" font-size="9" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">reina</text>
    <ellipse cx="140" cy="55" rx="16" ry="20" fill="#D9A441" opacity="0.9"/>
    <text x="140" y="59" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">obrera</text>
    <ellipse cx="215" cy="55" rx="16" ry="18" fill="#6B7A4F" opacity="0.9"/>
    <text x="215" y="59" font-size="8" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">zángano</text>
  </svg>`,

  hiveBoxDesign: `
  <svg viewBox="0 0 220 150" width="100%" style="max-width:220px">
    <rect x="40" y="20" width="140" height="30" rx="3" fill="#D9C48A" stroke="#3A2E22" stroke-width="2"/>
    <rect x="40" y="52" width="140" height="40" rx="3" fill="#B7A05F" stroke="#3A2E22" stroke-width="2"/>
    <rect x="40" y="94" width="140" height="30" rx="3" fill="#D9C48A" stroke="#3A2E22" stroke-width="2"/>
    <rect x="100" y="124" width="20" height="10" fill="#3A2E22"/>
    <text x="110" y="145" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">entrada angosta</text>
  </svg>`,

  lifecycleMelipona: `
  <svg viewBox="0 0 240 240" width="100%" style="max-width:240px">
    <circle cx="120" cy="120" r="85" fill="none" stroke="#D9CBAE" stroke-width="2" stroke-dasharray="4 5"/>
    <circle cx="120" cy="35" r="16" fill="#D9A441"/><text x="120" y="12" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">huevo</text>
    <circle cx="205" cy="120" r="16" fill="#C1613C"/><text x="205" y="146" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">larva</text>
    <circle cx="120" cy="205" r="16" fill="#6B7A4F"/><text x="120" y="230" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">pupa</text>
    <circle cx="35" cy="120" r="16" fill="#A34F30"/><text x="35" y="146" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">adulta</text>
  </svg>`,

  harvestSyringe: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <rect x="30" y="40" width="90" height="24" rx="4" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <rect x="34" y="44" width="45" height="16" fill="#D9A441" opacity="0.8"/>
    <line x1="120" y1="52" x2="160" y2="52" stroke="#3A2E22" stroke-width="3"/>
    <ellipse cx="185" cy="52" rx="22" ry="14" fill="#B7A05F" opacity="0.8"/>
    <text x="75" y="80" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">jeringa 60ml</text>
    <text x="185" y="80" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">pote de miel</text>
  </svg>`,

  robberBeeWarning: `
  <svg viewBox="0 0 240 110" width="100%" style="max-width:260px">
    <rect x="90" y="30" width="60" height="50" rx="4" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <rect x="112" y="70" width="16" height="10" fill="#3A2E22"/>
    <circle cx="45" cy="40" r="6" fill="#C1613C"/><circle cx="60" cy="55" r="6" fill="#C1613C"/><circle cx="35" cy="60" r="6" fill="#C1613C"/>
    <circle cx="195" cy="40" r="6" fill="#C1613C"/><circle cx="180" cy="55" r="6" fill="#C1613C"/><circle cx="205" cy="60" r="6" fill="#C1613C"/>
    <text x="120" y="100" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">asalto de Lestrimelitta en la entrada</text>
  </svg>`,

  lightGauge: `
  <svg viewBox="0 0 300 90" width="100%" style="max-width:320px">
    <rect x="10" y="30" width="280" height="18" rx="9" fill="url(#g3)"/>
    <defs><linearGradient id="g3" x1="0" x2="1">
      <stop offset="0%" stop-color="#3A2E22"/>
      <stop offset="35%" stop-color="#6B7A4F"/>
      <stop offset="70%" stop-color="#D9A441"/>
      <stop offset="100%" stop-color="#FFF3D6"/>
    </linearGradient></defs>
    <text x="10" y="70" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">oscuridad</text>
    <text x="150" y="70" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">12–16h luz de cultivo</text>
    <text x="280" y="70" font-size="9" text-anchor="end" fill="#3A2E22" font-family="Inter, sans-serif">sol pleno</text>
    <text x="150" y="22" font-size="9" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">horas de luz por día</text>
  </svg>`,

  potCrossSection: `
  <svg viewBox="0 0 220 150" width="100%" style="max-width:220px">
    <path d="M50 30 L170 30 L155 130 L65 130 Z" fill="none" stroke="#3A2E22" stroke-width="2.5"/>
    <rect x="60" y="115" width="100" height="8" fill="#3A2E22"/>
    <circle cx="110" cy="119" r="3" fill="#F3ECDD"/>
    <ellipse cx="110" cy="45" rx="55" ry="8" fill="#8A6A46" opacity="0.5"/>
    <rect x="70" y="45" width="80" height="55" fill="#B7A05F" opacity="0.55"/>
    <path d="M95 45 L95 20 M95 25 q-8 -8 -16 -2 M95 30 q8 -8 16 -2" stroke="#4F7942" stroke-width="3" fill="none" stroke-linecap="round"/>
    <text x="110" y="144" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">drenaje en la base</text>
  </svg>`,

  pruningDiagram: `
  <svg viewBox="0 0 260 120" width="100%" style="max-width:280px">
    <path d="M60 110 L60 30" stroke="#6B7A4F" stroke-width="4" stroke-linecap="round"/>
    <path d="M60 60 q-16 -6 -24 4 M60 65 q16 -6 24 4" stroke="#4F7942" stroke-width="3" fill="none" stroke-linecap="round"/>
    <line x1="40" y1="45" x2="80" y2="45" stroke="#C1613C" stroke-width="2" stroke-dasharray="3 3"/>
    <text x="130" y="45" font-size="8" fill="#C1613C" font-family="Inter, sans-serif">← corte acá, sobre el nudo</text>
    <path d="M200 110 L200 55" stroke="#6B7A4F" stroke-width="4" stroke-linecap="round"/>
    <path d="M200 70 q-14 -12 -6 -26 M200 70 q14 -12 6 -26" stroke="#4F7942" stroke-width="3" fill="none" stroke-linecap="round"/>
    <text x="200" y="118" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">brota doble</text>
  </svg>`,

  strawberryFlower: `
  <svg viewBox="0 0 200 130" width="100%" style="max-width:220px">
    <circle cx="100" cy="60" r="14" fill="#D9A441"/>
    <g fill="#FBF7EE" stroke="#D9CBAE" stroke-width="1.5">
      <ellipse cx="100" cy="30" rx="14" ry="20"/>
      <ellipse cx="100" cy="90" rx="14" ry="20"/>
      <ellipse cx="70" cy="60" rx="20" ry="14"/>
      <ellipse cx="130" cy="60" rx="20" ry="14"/>
      <ellipse cx="79" cy="39" rx="18" ry="13" transform="rotate(-45 79 39)"/>
    </g>
    <circle cx="100" cy="60" r="10" fill="#D9A441"/>
    <text x="100" y="120" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">pincel: anteras → centro</text>
  </svg>`,

  pestGuide: `
  <svg viewBox="0 0 280 110" width="100%" style="max-width:300px">
    <circle cx="45" cy="45" r="26" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <circle cx="38" cy="40" r="2.5" fill="#A34F30"/><circle cx="52" cy="42" r="2.5" fill="#A34F30"/><circle cx="45" cy="55" r="2.5" fill="#A34F30"/>
    <text x="45" y="90" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">ácaros: aire seco</text>
    <circle cx="140" cy="45" r="26" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <ellipse cx="140" cy="45" rx="9" ry="13" fill="#6B7A4F"/>
    <text x="140" y="90" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">pulgones: brotes</text>
    <circle cx="235" cy="45" r="26" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <circle cx="230" cy="40" r="3" fill="#3A2E22"/><circle cx="242" cy="50" r="3" fill="#3A2E22"/>
    <text x="235" y="90" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">mosquitas: sustrato húmedo</text>
  </svg>`,

  glutenNetwork: `
  <svg viewBox="0 0 260 110" width="100%" style="max-width:280px">
    <g stroke="#D9A441" stroke-width="2" fill="none" opacity="0.9">
      <path d="M20 30 Q60 10 90 40 T160 35 T230 45"/>
      <path d="M25 60 Q70 40 100 65 T170 60 T225 70"/>
      <path d="M30 90 Q65 70 95 90 T165 85 T220 92"/>
      <path d="M40 30 L40 90 M90 40 L95 90 M160 35 L165 85"/>
    </g>
    <text x="130" y="108" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">red de gluten — atrapa el gas de fermentación</text>
  </svg>`,

  flourBlendPie: `
  <svg viewBox="0 0 160 160" width="100%" style="max-width:180px">
    <circle cx="80" cy="80" r="70" fill="#D9C48A"/>
    <path d="M80 80 L80 10 A70 70 0 0 1 141 115 Z" fill="#B7A05F"/>
    <path d="M80 80 L141 115 A70 70 0 0 1 40 145 Z" fill="#8FAE72"/>
    <text x="55" y="45" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">50% arroz</text>
    <text x="105" y="105" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">30%</text>
    <text x="105" y="115" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">almidón</text>
    <text x="55" y="130" font-size="9" fill="#3A2E22" font-family="Inter, sans-serif">20% integral</text>
  </svg>`,

  bindingChoice: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <rect x="20" y="30" width="90" height="40" rx="6" fill="#D9A441" opacity="0.8"/>
    <text x="65" y="54" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">xantana</text>
    <text x="65" y="85" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">tortas, galletas</text>
    <rect x="150" y="20" width="90" height="60" rx="6" fill="#C1613C" opacity="0.85"/>
    <text x="195" y="54" font-size="9" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">psyllium</text>
    <text x="195" y="90" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">pan, miga abierta</text>
  </svg>`,

  doughHydration: `
  <svg viewBox="0 0 240 100" width="100%" style="max-width:260px">
    <ellipse cx="120" cy="70" rx="90" ry="18" fill="#D9C48A" opacity="0.7"/>
    <path d="M60 65 q60 -35 120 0" stroke="#B7A05F" stroke-width="8" fill="none" stroke-linecap="round"/>
    <circle cx="90" cy="55" r="4" fill="#7FA0C9"/><circle cx="120" cy="45" r="4" fill="#7FA0C9"/><circle cx="150" cy="55" r="4" fill="#7FA0C9"/>
    <text x="120" y="95" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">masa más húmeda que la de trigo</text>
  </svg>`,

  ovenBake: `
  <svg viewBox="0 0 220 130" width="100%" style="max-width:220px">
    <rect x="30" y="20" width="160" height="100" rx="6" fill="none" stroke="#3A2E22" stroke-width="2.5"/>
    <rect x="45" y="70" width="130" height="35" rx="4" fill="#B7815A"/>
    <path d="M55 70 q10 -14 20 0 M85 70 q10 -14 20 0 M115 70 q10 -14 20 0 M145 70 q10 -14 20 0" fill="none" stroke="#8B5A34" stroke-width="2"/>
    <path d="M50 35 q5 -10 0 -18 M100 35 q5 -10 0 -18 M150 35 q5 -10 0 -18" stroke="#D9CBAE" stroke-width="2" fill="none"/>
    <text x="110" y="124" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">vapor + 93–99°C interno</text>
  </svg>`,

  sourdoughJar: `
  <svg viewBox="0 0 140 160" width="100%" style="max-width:150px">
    <path d="M35 40 L35 140 Q35 150 45 150 L95 150 Q105 150 105 140 L105 40" fill="none" stroke="#3A2E22" stroke-width="2.5"/>
    <rect x="30" y="30" width="80" height="12" rx="3" fill="#3A2E22"/>
    <rect x="40" y="90" width="60" height="50" fill="#D9A441" opacity="0.7"/>
    <circle cx="55" cy="95" r="3" fill="#FBF7EE"/><circle cx="75" cy="100" r="3" fill="#FBF7EE"/><circle cx="65" cy="110" r="3" fill="#FBF7EE"/>
    <text x="70" y="14" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">arroz integral + trigo sarraceno</text>
  </svg>`,

  crossContam: `
  <svg viewBox="0 0 240 100" width="100%" style="max-width:260px">
    <rect x="20" y="30" width="80" height="50" rx="4" fill="#8FAE72" opacity="0.8"/>
    <text x="60" y="60" font-size="9" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">&lt;20 ppm</text>
    <text x="60" y="90" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">sin gluten</text>
    <line x1="115" y1="55" x2="145" y2="55" stroke="#3A2E22" stroke-width="2"/>
    <rect x="150" y="30" width="70" height="50" rx="4" fill="#C1613C" opacity="0.8"/>
    <text x="185" y="60" font-size="9" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">contacto</text>
    <text x="185" y="90" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">tostador, tabla</text>
  </svg>`,

  dueDateWheel: `
  <svg viewBox="0 0 220 220" width="100%" style="max-width:220px">
    <circle cx="110" cy="110" r="95" fill="none" stroke="#D9CBAE" stroke-width="2"/>
    <circle cx="110" cy="110" r="70" fill="none" stroke="#B7A05F" stroke-width="1.5" stroke-dasharray="3 4"/>
    <path d="M110 15 A95 95 0 0 1 205 110" fill="none" stroke="#C1613C" stroke-width="6"/>
    <path d="M205 110 A95 95 0 0 1 110 205" fill="none" stroke="#D9A441" stroke-width="6"/>
    <path d="M110 205 A95 95 0 0 1 15 110" fill="none" stroke="#6B7A4F" stroke-width="6"/>
    <text x="160" y="70" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">1er trim.</text>
    <text x="150" y="165" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">2do trim.</text>
    <text x="45" y="150" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">3er trim.</text>
    <text x="110" y="114" font-size="10" text-anchor="middle" fill="#3A2E22" font-family="JetBrains Mono, monospace">40 sem.</text>
  </svg>`,

  fetalGrowth1: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <circle cx="40" cy="55" r="6" fill="#D9A441"/>
    <circle cx="110" cy="55" r="14" fill="#D9A441" opacity="0.85"/>
    <circle cx="200" cy="55" r="26" fill="#D9A441" opacity="0.9"/>
    <path d="M188 40 q10 -6 18 0 M188 70 q10 6 18 0" stroke="#A34F30" stroke-width="2" fill="none"/>
    <text x="40" y="80" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">sem. 4</text>
    <text x="110" y="80" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">sem. 8</text>
    <text x="200" y="90" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">sem. 12</text>
  </svg>`,

  nutritionPlate: `
  <svg viewBox="0 0 200 200" width="100%" style="max-width:200px">
    <circle cx="100" cy="100" r="85" fill="#FBF7EE" stroke="#D9CBAE" stroke-width="2"/>
    <path d="M100 100 L100 15 A85 85 0 0 1 174 57 Z" fill="#8FAE72"/>
    <path d="M100 100 L174 57 A85 85 0 0 1 174 143 Z" fill="#D9A441"/>
    <path d="M100 100 L174 143 A85 85 0 0 1 100 185 Z" fill="#C1613C"/>
    <path d="M100 100 L100 185 A85 85 0 0 1 26 57 Z" fill="#B7A05F"/>
    <text x="130" y="45" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">folato</text>
    <text x="145" y="105" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">hierro</text>
    <text x="115" y="160" font-size="8" fill="#fff" font-family="Inter, sans-serif">calcio</text>
    <text x="45" y="105" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">DHA</text>
  </svg>`,

  prenatalSchedule: `
  <svg viewBox="0 0 280 90" width="100%" style="max-width:300px">
    <line x1="20" y1="45" x2="260" y2="45" stroke="#3A2E22" stroke-width="2"/>
    <circle cx="40" cy="45" r="5" fill="#6B7A4F"/><circle cx="90" cy="45" r="5" fill="#6B7A4F"/><circle cx="140" cy="45" r="5" fill="#D9A441"/>
    <circle cx="180" cy="45" r="5" fill="#D9A441"/><circle cx="215" cy="45" r="5" fill="#C1613C"/><circle cx="245" cy="45" r="5" fill="#C1613C"/>
    <text x="65" y="30" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">mensual</text>
    <text x="160" y="30" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cada 2 sem.</text>
    <text x="230" y="30" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">semanal</text>
    <text x="140" y="70" font-size="8" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">semana 8 → 28 → 36 → parto</text>
  </svg>`,

  fetalGrowth2: `
  <svg viewBox="0 0 200 110" width="100%" style="max-width:220px">
    <ellipse cx="100" cy="60" rx="45" ry="38" fill="#D9A441" opacity="0.85"/>
    <circle cx="80" cy="45" r="4" fill="#3A2E22"/>
    <path d="M65 65 q15 10 30 0" stroke="#3A2E22" stroke-width="2" fill="none"/>
    <text x="100" y="105" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">semanas 14–27</text>
  </svg>`,

  fetalGrowth3: `
  <svg viewBox="0 0 200 130" width="100%" style="max-width:220px">
    <ellipse cx="100" cy="70" rx="55" ry="48" fill="#D9A441" opacity="0.9"/>
    <circle cx="75" cy="45" r="5" fill="#3A2E22"/>
    <path d="M55 70 q20 14 40 0" stroke="#3A2E22" stroke-width="2.5" fill="none"/>
    <path d="M40 100 q60 25 120 0" stroke="#C1613C" stroke-width="2" fill="none" stroke-dasharray="3 3"/>
    <text x="100" y="125" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">semanas 28–40, cabeza abajo</text>
  </svg>`,

  warningSigns: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <polygon points="30,15 55,60 5,60" fill="none" stroke="#C1613C" stroke-width="2.5"/>
    <text x="30" y="52" font-size="12" text-anchor="middle" fill="#C1613C" font-family="Inter, sans-serif">!</text>
    <text x="30" y="80" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">sangrado</text>
    <polygon points="100,15 125,60 75,60" fill="none" stroke="#C1613C" stroke-width="2.5"/>
    <text x="100" y="52" font-size="12" text-anchor="middle" fill="#C1613C" font-family="Inter, sans-serif">!</text>
    <text x="100" y="80" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">visión borrosa</text>
    <polygon points="170,15 195,60 145,60" fill="none" stroke="#C1613C" stroke-width="2.5"/>
    <text x="170" y="52" font-size="12" text-anchor="middle" fill="#C1613C" font-family="Inter, sans-serif">!</text>
    <text x="170" y="80" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">menos movimiento</text>
    <polygon points="235,15 258,60 212,60" fill="none" stroke="#C1613C" stroke-width="2.5"/>
    <text x="235" y="52" font-size="12" text-anchor="middle" fill="#C1613C" font-family="Inter, sans-serif">!</text>
    <text x="235" y="80" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">fiebre</text>
  </svg>`,

  conditionsOverview: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <circle cx="45" cy="45" r="30" fill="none" stroke="#D9A441" stroke-width="3"/>
    <text x="45" y="50" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">glucosa</text>
    <circle cx="130" cy="45" r="30" fill="none" stroke="#C1613C" stroke-width="3"/>
    <text x="130" y="50" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">presión</text>
    <circle cx="215" cy="45" r="30" fill="none" stroke="#6B7A4F" stroke-width="3"/>
    <text x="215" y="50" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">placenta</text>
    <text x="130" y="92" font-size="8" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">monitoreadas en cada control</text>
  </svg>`,

  birthPlanChecklist: `
  <svg viewBox="0 0 220 130" width="100%" style="max-width:220px">
    <rect x="30" y="15" width="160" height="110" rx="6" fill="#FBF7EE" stroke="#D9CBAE" stroke-width="2"/>
    <rect x="45" y="35" width="12" height="12" fill="none" stroke="#6B7A4F" stroke-width="2"/>
    <line x1="65" y1="41" x2="160" y2="41" stroke="#B7A05F" stroke-width="2"/>
    <rect x="45" y="60" width="12" height="12" fill="#6B7A4F"/>
    <path d="M47 66 l3 3 l6 -6" stroke="#fff" stroke-width="1.5" fill="none"/>
    <line x1="65" y1="66" x2="160" y2="66" stroke="#B7A05F" stroke-width="2"/>
    <rect x="45" y="85" width="12" height="12" fill="none" stroke="#6B7A4F" stroke-width="2"/>
    <line x1="65" y1="91" x2="160" y2="91" stroke="#B7A05F" stroke-width="2"/>
  </svg>`,

  laborStages: `
  <svg viewBox="0 0 280 100" width="100%" style="max-width:300px">
    <rect x="10" y="35" width="120" height="30" rx="4" fill="#D9A441" opacity="0.8"/>
    <text x="70" y="55" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">1: dilatación</text>
    <rect x="135" y="35" width="80" height="30" rx="4" fill="#C1613C" opacity="0.85"/>
    <text x="175" y="55" font-size="8" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">2: pujo</text>
    <rect x="220" y="35" width="55" height="30" rx="4" fill="#6B7A4F" opacity="0.85"/>
    <text x="247" y="55" font-size="8" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">3: placenta</text>
    <text x="140" y="85" font-size="7.5" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">0 cm → 10 cm → nacimiento → alumbramiento</text>
  </svg>`,

  deliveryTypes: `
  <svg viewBox="0 0 220 100" width="100%" style="max-width:240px">
    <path d="M60 20 Q30 50 60 85" stroke="#6B7A4F" stroke-width="6" fill="none" stroke-linecap="round"/>
    <text x="60" y="98" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">parto vaginal</text>
    <rect x="140" y="30" width="60" height="45" rx="6" fill="none" stroke="#C1613C" stroke-width="3"/>
    <line x1="150" y1="52" x2="190" y2="52" stroke="#C1613C" stroke-width="3"/>
    <text x="170" y="98" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">cesárea</text>
  </svg>`,

  apgarScore: `
  <svg viewBox="0 0 260 100" width="100%" style="max-width:280px">
    <rect x="10" y="15" width="240" height="65" rx="6" fill="none" stroke="#3A2E22" stroke-width="2"/>
    <line x1="10" y1="35" x2="250" y2="35" stroke="#D9CBAE" stroke-width="1.5"/>
    <text x="20" y="28" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">Apariencia · Pulso · Gesto · Actividad · Respiración</text>
    <text x="130" y="60" font-size="16" text-anchor="middle" fill="#C1613C" font-family="JetBrains Mono, monospace">0–10</text>
    <text x="130" y="92" font-size="8" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">medido al minuto y a los 5 minutos</text>
  </svg>`,

  postpartumRecovery: `
  <svg viewBox="0 0 240 90" width="100%" style="max-width:260px">
    <rect x="10" y="30" width="220" height="18" rx="9" fill="url(#g4)"/>
    <defs><linearGradient id="g4" x1="0" x2="1">
      <stop offset="0%" stop-color="#C1613C"/>
      <stop offset="50%" stop-color="#D9A441"/>
      <stop offset="100%" stop-color="#8FAE72"/>
    </linearGradient></defs>
    <text x="10" y="70" font-size="8" fill="#3A2E22" font-family="Inter, sans-serif">días 1–3</text>
    <text x="120" y="70" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">semanas 2–4</text>
    <text x="230" y="70" font-size="8" text-anchor="end" fill="#3A2E22" font-family="Inter, sans-serif">semana 6</text>
  </svg>`,

  ppdVsBabyBlues: `
  <svg viewBox="0 0 240 100" width="100%" style="max-width:260px">
    <rect x="15" y="20" width="95" height="55" rx="6" fill="#D9A441" opacity="0.8"/>
    <text x="62" y="45" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">baby blues</text>
    <text x="62" y="60" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">&lt; 2 semanas</text>
    <rect x="130" y="20" width="95" height="55" rx="6" fill="#C1613C" opacity="0.85"/>
    <text x="177" y="45" font-size="8" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">depresión posparto</text>
    <text x="177" y="60" font-size="7.5" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">&gt; 2 semanas</text>
  </svg>`,

  breastfeedingLatch: `
  <svg viewBox="0 0 200 110" width="100%" style="max-width:200px">
    <circle cx="80" cy="55" r="38" fill="#FBF7EE" stroke="#D9CBAE" stroke-width="2"/>
    <circle cx="120" cy="55" r="14" fill="#D9A441"/>
    <path d="M105 55 Q95 45 85 55 Q95 65 105 55" fill="#C1613C" opacity="0.8"/>
    <text x="100" y="100" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">buen agarre: areola, no solo pezón</text>
  </svg>`,

  safeSleepCrib: `
  <svg viewBox="0 0 220 130" width="100%" style="max-width:220px">
    <rect x="30" y="30" width="160" height="80" rx="4" fill="none" stroke="#3A2E22" stroke-width="2.5"/>
    <line x1="45" y1="30" x2="45" y2="110" stroke="#3A2E22" stroke-width="2"/>
    <line x1="65" y1="30" x2="65" y2="110" stroke="#3A2E22" stroke-width="2"/>
    <line x1="85" y1="30" x2="85" y2="110" stroke="#3A2E22" stroke-width="2"/>
    <line x1="135" y1="30" x2="135" y2="110" stroke="#3A2E22" stroke-width="2"/>
    <line x1="155" y1="30" x2="155" y2="110" stroke="#3A2E22" stroke-width="2"/>
    <line x1="175" y1="30" x2="175" y2="110" stroke="#3A2E22" stroke-width="2"/>
    <ellipse cx="110" cy="90" rx="30" ry="12" fill="#D9A441" opacity="0.85"/>
    <circle cx="110" cy="72" r="10" fill="#D9A441" opacity="0.85"/>
    <text x="110" y="125" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">boca arriba, superficie firme, nada suelto</text>
  </svg>`,

  prepChecklist: `
  <svg viewBox="0 0 220 130" width="100%" style="max-width:220px">
    <rect x="30" y="15" width="160" height="110" rx="6" fill="#FBF7EE" stroke="#D9CBAE" stroke-width="2"/>
    <rect x="45" y="35" width="12" height="12" fill="#6B7A4F"/><path d="M47 41 l3 3 l6 -6" stroke="#fff" stroke-width="1.5" fill="none"/>
    <line x1="65" y1="41" x2="160" y2="41" stroke="#B7A05F" stroke-width="2"/>
    <rect x="45" y="60" width="12" height="12" fill="#6B7A4F"/><path d="M47 66 l3 3 l6 -6" stroke="#fff" stroke-width="1.5" fill="none"/>
    <line x1="65" y1="66" x2="160" y2="66" stroke="#B7A05F" stroke-width="2"/>
    <rect x="45" y="85" width="12" height="12" fill="none" stroke="#6B7A4F" stroke-width="2"/>
    <line x1="65" y1="91" x2="160" y2="91" stroke="#B7A05F" stroke-width="2"/>
  </svg>`,

  landZoning: `
  <svg viewBox="0 0 240 180" width="100%" style="max-width:260px">
    <rect x="10" y="10" width="220" height="160" rx="4" fill="none" stroke="#3A2E22" stroke-width="2.5"/>
    <rect x="16" y="16" width="80" height="55" fill="#C1613C" opacity="0.55"/>
    <rect x="100" y="16" width="60" height="80" fill="#8FAE72" opacity="0.6"/>
    <rect x="164" y="16" width="60" height="45" fill="#D9A441" opacity="0.6"/>
    <rect x="16" y="75" width="80" height="90" fill="#B7A05F" opacity="0.5"/>
    <rect x="100" y="100" width="60" height="65" fill="#6B7A4F" opacity="0.55"/>
    <rect x="164" y="65" width="60" height="100" fill="#7FA0C9" opacity="0.45"/>
    <text x="56" y="47" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">casa</text>
    <text x="130" y="60" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">huerta</text>
    <text x="194" y="42" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">solar</text>
    <text x="56" y="122" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">taller</text>
    <text x="130" y="135" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">animales</text>
    <text x="194" y="118" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">agua</text>
  </svg>`,

  waterSystemDiagram: `
  <svg viewBox="0 0 260 140" width="100%" style="max-width:280px">
    <path d="M40 20 L60 20 L60 40 L40 40 Z" fill="#7FA0C9" opacity="0.7"/>
    <text x="50" y="55" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">techo</text>
    <path d="M60 30 L120 30" stroke="#3A2E22" stroke-width="2"/>
    <ellipse cx="150" cy="70" rx="35" ry="22" fill="#B7A05F" opacity="0.6"/>
    <text x="150" y="74" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">aljibe</text>
    <rect x="205" y="45" width="40" height="35" rx="4" fill="#8FAE72" opacity="0.7"/>
    <text x="225" y="66" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">tanque</text>
    <path d="M150 92 Q90 120 40 110" stroke="#3A2E22" stroke-width="1.5" fill="none" stroke-dasharray="3 3"/>
    <ellipse cx="35" cy="112" rx="28" ry="14" fill="#D9C48A" opacity="0.6"/>
    <text x="35" y="116" font-size="7" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">tajamar</text>
  </svg>`,

  cisternCrossSection: `
  <svg viewBox="0 0 200 160" width="100%" style="max-width:200px">
    <rect x="10" y="130" width="180" height="10" fill="#8A6A46" opacity="0.4"/>
    <path d="M50 30 L150 30 L150 130 L50 130 Z" fill="none" stroke="#3A2E22" stroke-width="2.5"/>
    <rect x="55" y="70" width="90" height="55" fill="#7FA0C9" opacity="0.55"/>
    <path d="M60 30 L60 10 M140 30 L140 10" stroke="#3A2E22" stroke-width="2"/>
    <path d="M50 45 q50 -12 100 0" stroke="#B7A05F" stroke-width="2" fill="none" stroke-dasharray="2 3"/>
    <text x="100" y="150" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">primera lluvia desviada arriba</text>
  </svg>`,

  solarSizing: `
  <svg viewBox="0 0 280 100" width="100%" style="max-width:300px">
    <rect x="10" y="20" width="60" height="35" rx="2" fill="#7FA0C9" opacity="0.7"/>
    <text x="40" y="70" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">paneles</text>
    <path d="M75 37 L110 37" stroke="#3A2E22" stroke-width="2"/>
    <rect x="115" y="15" width="45" height="45" rx="4" fill="#D9A441" opacity="0.75"/>
    <text x="137" y="70" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">batería</text>
    <path d="M165 37 L195 37" stroke="#3A2E22" stroke-width="2"/>
    <rect x="200" y="20" width="55" height="35" rx="4" fill="#C1613C" opacity="0.75"/>
    <text x="227" y="70" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">inversor</text>
    <text x="140" y="92" font-size="7.5" text-anchor="middle" fill="#6b5c48" font-family="Inter, sans-serif">consumo diario (Wh) primero, siempre</text>
  </svg>`,

  canningMethods: `
  <svg viewBox="0 0 240 110" width="100%" style="max-width:260px">
    <rect x="15" y="30" width="80" height="55" rx="6" fill="#8FAE72" opacity="0.75"/>
    <text x="55" y="60" font-size="8" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">baño de agua</text>
    <text x="55" y="95" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">alimentos ácidos</text>
    <rect x="140" y="20" width="85" height="65" rx="6" fill="#C1613C" opacity="0.8"/>
    <text x="182" y="50" font-size="8" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">olla a presión</text>
    <text x="182" y="66" font-size="7.5" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">baja acidez</text>
    <text x="182" y="100" font-size="7.5" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">único método seguro</text>
  </svg>`,

  resilienceMap: `
  <svg viewBox="0 0 240 130" width="100%" style="max-width:260px">
    <circle cx="120" cy="65" r="12" fill="#C1613C"/>
    <text x="120" y="69" font-size="7" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">finca</text>
    <circle cx="50" cy="25" r="9" fill="#7FA0C9" opacity="0.85"/><text x="50" y="12" font-size="7" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">agua</text>
    <circle cx="190" cy="25" r="9" fill="#D9A441" opacity="0.85"/><text x="190" y="12" font-size="7" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">energía</text>
    <circle cx="50" cy="105" r="9" fill="#8FAE72" opacity="0.85"/><text x="50" y="122" font-size="7" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">alimento</text>
    <circle cx="190" cy="105" r="9" fill="#6B7A4F" opacity="0.85"/><text x="190" y="122" font-size="7" text-anchor="middle" fill="#3A2E22" font-family="Inter, sans-serif">economía</text>
    <line x1="120" y1="65" x2="50" y2="25" stroke="#3A2E22" stroke-width="1.5" stroke-dasharray="2 3"/>
    <line x1="120" y1="65" x2="190" y2="25" stroke="#3A2E22" stroke-width="1.5" stroke-dasharray="2 3"/>
    <line x1="120" y1="65" x2="50" y2="105" stroke="#3A2E22" stroke-width="1.5" stroke-dasharray="2 3"/>
    <line x1="120" y1="65" x2="190" y2="105" stroke="#3A2E22" stroke-width="1.5" stroke-dasharray="2 3"/>
  </svg>`,
};

/* ---------------------------- Global search ---------------------------- */

function buildSearchIndex(){
  const entries = [];
  getCourseIds().forEach(id => {
    const course = getCourse(id);
    if (!course) return;
    entries.push({ courseId: id, courseTitle: course.title, blockId: null, blockLabel: null, field: 'título del curso', text: course.title, weight: 3 });
    if (course.subtitle) entries.push({ courseId: id, courseTitle: course.title, blockId: null, blockLabel: null, field: 'subtítulo', text: course.subtitle, weight: 1 });
    if (course.description) entries.push({ courseId: id, courseTitle: course.title, blockId: null, blockLabel: null, field: 'descripción', text: course.description, weight: 1 });
    (course.blocks || []).forEach(block => {
      const blockLabel = `Bloque ${block.number}: ${block.title}`;
      entries.push({ courseId: id, courseTitle: course.title, blockId: block.id, blockLabel, field: 'bloque', text: block.title, weight: 3 });
      if (block.goal) entries.push({ courseId: id, courseTitle: course.title, blockId: block.id, blockLabel, field: 'objetivo', text: block.goal, weight: 1 });
      (block.learn || []).forEach(item => {
        entries.push({ courseId: id, courseTitle: course.title, blockId: block.id, blockLabel, field: item.term, text: item.term, weight: 2 });
        entries.push({ courseId: id, courseTitle: course.title, blockId: block.id, blockLabel, field: item.term, text: item.body, weight: 1 });
      });
      if (block.project) entries.push({ courseId: id, courseTitle: course.title, blockId: block.id, blockLabel, field: 'proyecto', text: block.project, weight: 1 });
      if (block.check) entries.push({ courseId: id, courseTitle: course.title, blockId: block.id, blockLabel, field: 'chequeo', text: block.check, weight: 1 });
    });
    (course.finalChallenge || []).forEach(item => {
      entries.push({ courseId: id, courseTitle: course.title, blockId: null, blockLabel: 'Desafío final', field: 'desafío final', text: item, weight: 1 });
    });
  });
  return entries;
}

function snippetAround(text, query, radius=70){
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return escapeHTML(text.slice(0, radius*2));
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  const escaped = escapeHTML(snippet);
  const re = new RegExp(escapeHTML(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return escaped.replace(re, (m) => `<mark>${m}</mark>`);
}

function performSearch(query){
  const q = query.trim();
  if (q.length < 2) return [];
  const index = buildSearchIndex();
  const qLower = q.toLowerCase();
  const matches = index.filter(e => e.text && e.text.toLowerCase().includes(qLower));
  // dedupe by course+block+field, keep highest weight, sort by weight desc
  const seen = new Map();
  matches.forEach(m => {
    const key = `${m.courseId}|${m.blockId}|${m.field}|${m.text.slice(0,30)}`;
    if (!seen.has(key) || seen.get(key).weight < m.weight) seen.set(key, m);
  });
  return Array.from(seen.values()).sort((a,b) => b.weight - a.weight).slice(0, 40);
}

function renderSearchResults(query){
  const wrap = document.getElementById('search-results');
  wrap.innerHTML = '';
  const q = query.trim();
  if (q.length < 2){
    wrap.innerHTML = `<div class="search-hint">Escribí al menos 2 letras para buscar en títulos, bloques, conceptos, proyectos y chequeos de todos tus cursos.</div>`;
    return;
  }
  const results = performSearch(q);
  if (results.length === 0){
    wrap.innerHTML = `<div class="search-hint">Sin resultados para "${escapeHTML(q)}".</div>`;
    return;
  }
  results.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'search-result';
    btn.type = 'button';
    btn.innerHTML = `
      <div class="search-result-course">${escapeHTML(r.courseTitle)}${r.blockLabel ? ' · ' + escapeHTML(r.blockLabel) : ''}</div>
      <div class="search-result-title">${escapeHTML(r.field)}</div>
      <div class="search-result-snippet">${snippetAround(r.text, q)}</div>
    `;
    btn.addEventListener('click', () => {
      closeSearch();
      state.currentCategory = null;
      openCourse(r.courseId);
      if (r.blockId){
        openBlockId = r.blockId;
        renderCourse();
        requestAnimationFrame(() => {
          const el = document.querySelector(`.block-card[data-block-id="${CSS.escape(r.blockId)}"]`);
          if (el){
            el.scrollIntoView({ behavior:'smooth', block:'start' });
            el.style.outline = `2px solid var(--ochre)`;
            setTimeout(() => { el.style.outline = 'none'; }, 1600);
          }
        });
      }
    });
    wrap.appendChild(btn);
  });
}

function openSearch(){
  document.getElementById('search-overlay').classList.remove('hidden');
  const input = document.getElementById('search-input');
  input.value = '';
  renderSearchResults('');
  setTimeout(() => input.focus(), 50);
}

function closeSearch(){
  document.getElementById('search-overlay').classList.add('hidden');
}

/* ---------------------------- Event wiring ---------------------------- */

function wireEvents(){
  document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

  document.getElementById('btn-search-open').addEventListener('click', openSearch);
  document.getElementById('btn-course-search-open').addEventListener('click', openSearch);
  document.getElementById('btn-category-search-open').addEventListener('click', openSearch);
  document.getElementById('btn-search-close').addEventListener('click', closeSearch);
  document.getElementById('search-input').addEventListener('input', (e) => renderSearchResults(e.target.value));
  document.getElementById('search-overlay').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });

  document.getElementById('btn-category-back').addEventListener('click', closeCategory);

  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input-course').click());
  document.getElementById('btn-import-empty').addEventListener('click', () => document.getElementById('file-input-course').click());
  document.getElementById('file-input-course').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importFromFile(file, (result) => {
      if (state.currentCourseId && result && result.id === state.currentCourseId){
        renderCourse();
      } else {
        renderHome();
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

    if (action === 'edit-course'){
      enterEditor();
    } else if (action === 'export-progress'){
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
          renderHome();
        } else {
          handleImportedObject(obj);
          renderHome();
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
  for (const url of DEFAULT_COURSE_URLS){
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const course = await res.json();
      if (looksLikeCourse(course)){
        handleImportedObject(course, {silent:true});
      }
    } catch { /* offline on first load with no cache yet — user can import manually */ }
  }
}

async function init(){
  applyTheme(getStoredTheme());
  wireEvents();
  await maybeSeedDefaultCourse();
  renderHome();

  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

init();
