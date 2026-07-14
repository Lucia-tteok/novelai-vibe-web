const $ = (s) => document.querySelector(s);
const fileInput = $('#file'), drop = $('#drop'), preview = $('#preview');
const strength = $('#strength'), strengthValue = $('#strengthValue'), status = $('#status');
const submit = $('#submit'), tokenInput = $('#token'), toggleToken = $('#toggleToken');
const rememberToken = $('#rememberToken'), saveLast = $('#saveLast');
const tabMaker = $('#tabMaker'), tabLibrary = $('#tabLibrary'), makerPanel = $('#makerPanel'), libraryPanel = $('#libraryPanel');
const libraryList = $('#libraryList'), libraryEmpty = $('#libraryEmpty'), libraryCount = $('#libraryCount'), importVibe = $('#importVibe');

const FIXED_ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';
const TOKEN_KEY = 'novelai_vibe_token', REMEMBER_KEY = 'novelai_vibe_remember_token';
const DB_NAME = 'novelai-vibe-library', STORE_NAME = 'vibes';
let imageBase64 = '', thumbnail = '', lastVibe = null, lastFilename = '';

function show(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"', "'": '&#39;' }[c])); }

function switchTab(tab) {
  const lib = tab === 'library';
  tabMaker.classList.toggle('active', !lib); tabLibrary.classList.toggle('active', lib);
  makerPanel.classList.toggle('hidden', lib); libraryPanel.classList.toggle('hidden', !lib);
  if (lib) renderLibrary();
}
tabMaker.onclick = () => switchTab('maker');
tabLibrary.onclick = () => switchTab('library');

function initTokenRemember() {
  const remember = localStorage.getItem(REMEMBER_KEY) === '1';
  rememberToken.checked = remember;
  if (remember) tokenInput.value = localStorage.getItem(TOKEN_KEY) || '';
}
function syncTokenRemember() {
  if (rememberToken.checked) {
    localStorage.setItem(REMEMBER_KEY, '1');
    localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
  } else {
    localStorage.removeItem(REMEMBER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
}
rememberToken.onchange = syncTokenRemember;
tokenInput.oninput = () => { if (rememberToken.checked) syncTokenRemember(); };

toggleToken.onclick = () => { const show = tokenInput.type === 'password'; tokenInput.type = show ? 'text' : 'password'; toggleToken.textContent = show ? '隐藏' : '显示'; };
strength.oninput = () => strengthValue.value = Number(strength.value).toFixed(2);

function readFile(file) {
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return show('仅支持 PNG、JPEG、WebP', true);
  if (file.size > 10 * 1024 * 1024) return show('图片不能超过 10 MB', true);
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    imageBase64 = dataUrl.split(',')[1] || '';
    preview.src = dataUrl; drop.classList.add('has-image');
    thumbnail = await makeThumbnail(dataUrl);
    show(`${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`);
  };
  reader.readAsDataURL(file);
}

function makeThumbnail(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 256 / Math.max(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject; img.src = src;
  });
}
function modelKey(model) { if (model.includes('4-5-curated')) return 'v4-5curated'; if (model.includes('4-5-full')) return 'v4-5full'; if (model.includes('4-curated')) return 'v4curated'; if (model.includes('4-full')) return 'v4full'; return model; }
async function sha256Hex(text) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function arrayBufferToBase64(buffer) { const bytes = new Uint8Array(buffer); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }
function downloadJson(filename, data) { const blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function dbPut(item) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put(item); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }).finally(() => db.close()); }
async function dbGetAll() { const db = await openDb(); return new Promise((resolve, reject) => { const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll(); req.onsuccess = () => resolve(req.result.sort((a,b) => b.savedAt - a.savedAt)); req.onerror = () => reject(req.error); }).finally(() => db.close()); }
async function dbDelete(id) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }).finally(() => db.close()); }

function normalizeVibe(vibe, filename = '') {
  if (!vibe || typeof vibe !== 'object') throw new Error('不是有效 JSON');
  if (vibe.identifier !== 'novelai-vibe-transfer') throw new Error('不是 NovelAI Vibe 文件');
  const id = String(vibe.id || crypto.randomUUID());
  const baseName = filename.replace(/\.(json|naiv4vibe)$/i, '');
  const name = String(vibe.name || baseName || id.slice(0, 12));
  const encModel = Object.keys(vibe.encodings || {})[0] || 'unknown';
  return { id, name, filename: filename || `${name}.naiv4vibe`, thumbnail: typeof vibe.thumbnail === 'string' ? vibe.thumbnail : '', model: vibe.importInfo?.model || encModel, createdAt: Number(vibe.createdAt || Date.now()), savedAt: Date.now(), vibe };
}
function extractVibes(data) {
  if (Array.isArray(data)) return data;
  if (data?.identifier === 'novelai-vibe-transfer') return [data];
  for (const key of ['vibes', 'items', 'data', 'children']) if (Array.isArray(data?.[key])) return data[key];
  if (data && typeof data === 'object') {
    const nested = Object.values(data).filter(v => v && typeof v === 'object' && v.identifier === 'novelai-vibe-transfer');
    if (nested.length) return nested;
  }
  throw new Error('未找到可导入的 Vibe');
}
async function saveVibeToLibrary(vibe, filename) { const item = normalizeVibe(vibe, filename); await dbPut(item); await renderLibrary(); return item; }

saveLast.onclick = async () => { if (!lastVibe) return; try { const item = await saveVibeToLibrary(lastVibe, lastFilename); show(`已保存到 Vibe库：${item.name}`); } catch (e) { show(e.message || String(e), true); } };

async function renderLibrary() {
  const items = await dbGetAll(); libraryCount.textContent = String(items.length); libraryList.innerHTML = ''; libraryEmpty.classList.toggle('hidden', items.length > 0);
  for (const item of items) {
    const card = document.createElement('article'); card.className = 'vibe-card';
    card.innerHTML = `<div class="thumb">${item.thumbnail ? `<img src="${item.thumbnail}" alt="">` : '<div class="no-thumb">VIBE</div>'}</div><div class="vibe-info"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span>${escapeHtml(item.model)} · ${new Date(item.savedAt).toLocaleString()}</span></div><div class="vibe-actions"><button class="secondary download" type="button">下载</button><button class="danger delete" type="button">删除</button></div>`;
    card.querySelector('.download').onclick = () => downloadJson(item.filename || `${item.name}.naiv4vibe`, item.vibe);
    card.querySelector('.delete').onclick = async () => { if (confirm(`删除「${item.name}」？`)) { await dbDelete(item.id); await renderLibrary(); } };
    libraryList.appendChild(card);
  }
}

importVibe.onchange = async () => {
  const files = [...importVibe.files]; let ok = 0, fail = 0;
  for (const file of files) {
    try {
      const list = extractVibes(JSON.parse(await file.text()));
      for (let i = 0; i < list.length; i++) { await saveVibeToLibrary(list[i], list.length > 1 ? `${file.name.replace(/\.(json|naiv4vibe)$/i, '')}-${i + 1}.naiv4vibe` : file.name); ok++; }
    } catch (e) { console.warn(file.name, e); fail++; }
  }
  importVibe.value = ''; await renderLibrary(); switchTab('library'); show(`导入完成：成功 ${ok} 个，失败 ${fail} 个`, fail > 0);
};

fileInput.onchange = () => readFile(fileInput.files[0]);
for (const ev of ['dragenter','dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); });
for (const ev of ['dragleave','drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); });
drop.ondrop = e => readFile(e.dataTransfer.files[0]);

$('#form').onsubmit = async (event) => {
  event.preventDefault();
  if (!imageBase64) return show('请先选择参考图片', true);
  const token = tokenInput.value.trim();
  if (!token) return show('请填写你自己的 NovelAI Token', true);
  if (/\r|\n/.test(token)) return show('Token 格式无效', true);
  syncTokenRemember(); submit.disabled = true; saveLast.disabled = true; show('正在直连 NovelAI 编码…');
  try {
    const model = $('#model').value;
    const response = await fetch('https://image.novelai.net/ai/encode-vibe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ image: imageBase64, information_extracted: 1, model }) });
    if (!response.ok) { const text = await response.text().catch(() => ''); let msg = text || response.statusText; try { msg = JSON.parse(text).message || msg; } catch {} throw new Error(`NovelAI API 错误 (${response.status}): ${msg}`); }
    const encodedBase64 = arrayBufferToBase64(await response.arrayBuffer());
    const id = await sha256Hex(imageBase64);
    const vibe = { identifier: 'novelai-vibe-transfer', version: 1, type: 'image', image: imageBase64, id, encodings: { [modelKey(model)]: { [FIXED_ENCODING_KEY]: { encoding: encodedBase64, params: { information_extracted: 1 } } } }, name: `${id.slice(0, 6)}-${id.slice(-6)}`, thumbnail, createdAt: Date.now(), importInfo: { model, information_extracted: 1, strength: Number(strength.value) } };
    const filename = `${vibe.name}.naiv4vibe`; lastVibe = vibe; lastFilename = filename; saveLast.disabled = false; downloadJson(filename, vibe); show(`生成成功：${filename}。可点击“保存到 Vibe库”。`);
  } catch (e) { show(e.message || String(e), true); } finally { submit.disabled = false; }
};

initTokenRemember(); renderLibrary();