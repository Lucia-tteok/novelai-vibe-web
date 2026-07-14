const $ = (s) => document.querySelector(s);
const fileInput = $('#file');
const drop = $('#drop');
const preview = $('#preview');
const strength = $('#strength');
const strengthValue = $('#strengthValue');
const status = $('#status');
const submit = $('#submit');
const tokenInput = $('#token');
const toggleToken = $('#toggleToken');
let imageDataUrl = '';
let thumbnail = '';

strength.addEventListener('input', () => strengthValue.value = Number(strength.value).toFixed(2));
toggleToken.addEventListener('click', () => {
  const showToken = tokenInput.type === 'password';
  tokenInput.type = showToken ? 'text' : 'password';
  toggleToken.textContent = showToken ? '隐藏' : '显示';
});

function readFile(file) {
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return show('仅支持 PNG、JPEG、WebP', true);
  if (file.size > 10 * 1024 * 1024) return show('图片不能超过 10 MB', true);
  const reader = new FileReader();
  reader.onload = async () => {
    imageDataUrl = reader.result;
    preview.src = imageDataUrl;
    drop.classList.add('has-image');
    thumbnail = await makeThumbnail(imageDataUrl);
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
      resolve(canvas.toDataURL('image/jpeg', .8));
    };
    img.onerror = reject;
    img.src = src;
  });
}

fileInput.addEventListener('change', () => readFile(fileInput.files[0]));
for (const event of ['dragenter','dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag'); });
for (const event of ['dragleave','drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag'); });
drop.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));

function show(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

$('#form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!imageDataUrl) return show('请先选择参考图片', true);
  const token = tokenInput.value.trim();
  if (!token) return show('请填写你自己的 NovelAI Token', true);
  submit.disabled = true;
  show('正在调用 NovelAI 编码…');
  try {
    const response = await fetch('/api/vibe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, image: imageDataUrl, thumbnail, model: $('#model').value, strength: Number(strength.value) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `请求失败 (${response.status})`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const name = disposition.match(/filename="([^"]+)"/)?.[1] || 'vibe.naiv4vibe';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    show(`生成成功：${name}`);
  } catch (error) {
    show(error.message, true);
  } finally {
    submit.disabled = false;
  }
});