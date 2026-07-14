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

const FIXED_ENCODING_KEY = 'b36a8472fe418d9f80d6bb1c54e3a6e62c62936aa7bf31dae2bcf7e929f6430f';
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
let imageDataUrl = '';
let imageBase64 = '';
let thumbnail = '';

strength.addEventListener('input', () => strengthValue.value = Number(strength.value).toFixed(2));
toggleToken.addEventListener('click', () => {
  const showToken = tokenInput.type === 'password';
  tokenInput.type = showToken ? 'text' : 'password';
  toggleToken.textContent = showToken ? '隐藏' : '显示';
});

function show(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function readFile(file) {
  if (!file) return;
  if (!ALLOWED_TYPES.includes(file.type)) return show('仅支持 PNG、JPEG、WebP', true);
  if (file.size > 10 * 1024 * 1024) return show('图片不能超过 10 MB', true);
  const reader = new FileReader();
  reader.onload = async () => {
    imageDataUrl = reader.result;
    imageBase64 = imageDataUrl.split(',')[1] || '';
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
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = src;
  });
}

function modelKey(model) {
  if (model.includes('4-5-curated')) return 'v4-5curated';
  if (model.includes('4-5-full')) return 'v4-5full';
  if (model.includes('4-curated')) return 'v4curated';
  if (model.includes('4-full')) return 'v4full';
  return model;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

fileInput.addEventListener('change', () => readFile(fileInput.files[0]));
for (const event of ['dragenter', 'dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag'); });
drop.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));

$('#form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!imageBase64) return show('请先选择参考图片', true);
  const token = tokenInput.value.trim();
  if (!token) return show('请填写你自己的 NovelAI Token', true);
  if (/\r|\n/.test(token)) return show('Token 格式无效', true);

  submit.disabled = true;
  show('正在直连 NovelAI 编码…');
  try {
    const model = $('#model').value;
    const response = await fetch('https://image.novelai.net/ai/encode-vibe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ image: imageBase64, information_extracted: 1, model }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = text || response.statusText;
      try { message = JSON.parse(text).message || message; } catch {}
      throw new Error(`NovelAI API 错误 (${response.status}): ${message}`);
    }
    const encodedBase64 = arrayBufferToBase64(await response.arrayBuffer());
    const id = await sha256Hex(imageBase64);
    const vibe = {
      identifier: 'novelai-vibe-transfer',
      version: 1,
      type: 'image',
      image: imageBase64,
      id,
      encodings: {
        [modelKey(model)]: {
          [FIXED_ENCODING_KEY]: {
            encoding: encodedBase64,
            params: { information_extracted: 1 },
          },
        },
      },
      name: `${id.slice(0, 6)}-${id.slice(-6)}`,
      thumbnail,
      createdAt: Date.now(),
      importInfo: { model, information_extracted: 1, strength: Number(strength.value) },
    };
    const filename = `${vibe.name}.naiv4vibe`;
    downloadJson(filename, vibe);
    show(`生成成功：${filename}`);
  } catch (error) {
    show(error.message || String(error), true);
  } finally {
    submit.disabled = false;
  }
});