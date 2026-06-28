import './styles.css';
import { CONFIG } from './config.js';

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d', { alpha: false });
const $ = (id) => document.getElementById(id);

const state = {
  dpr: Math.max(1, Math.min(CONFIG.maxDevicePixelRatio, window.devicePixelRatio || 1)),
  cameraX: readNumber('whitevoid.cameraX', Math.floor(Math.random() * CONFIG.worldSize)),
  cameraY: readNumber('whitevoid.cameraY', Math.floor(Math.random() * CONFIG.worldSize)),
  zoom: readNumber('whitevoid.zoom', 1),
  strokes: new Map(),
  drawing: false,
  panning: false,
  lastPointer: null,
  activeStroke: [],
  sessionId: localStorage.getItem('whitevoid.sessionId') || crypto.randomUUID(),
  lastLoadKey: '',
  loading: false
};

localStorage.setItem('whitevoid.sessionId', state.sessionId);

function readNumber(key, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function saveCamera() {
  localStorage.setItem('whitevoid.cameraX', String(Math.round(state.cameraX)));
  localStorage.setItem('whitevoid.cameraY', String(Math.round(state.cameraY)));
  localStorage.setItem('whitevoid.zoom', String(state.zoom));
}

function resize() {
  state.dpr = Math.max(1, Math.min(CONFIG.maxDevicePixelRatio, window.devicePixelRatio || 1));
  canvas.width = Math.floor(innerWidth * state.dpr);
  canvas.height = Math.floor(innerHeight * state.dpr);
  render();
}

function screenToWorld(x, y) {
  return {
    x: Math.round(state.cameraX + (x - innerWidth / 2) / state.zoom),
    y: Math.round(state.cameraY + (y - innerHeight / 2) / state.zoom)
  };
}

function worldToScreen(x, y) {
  return {
    x: (x - state.cameraX) * state.zoom + innerWidth / 2,
    y: (y - state.cameraY) * state.zoom + innerHeight / 2
  };
}

function viewportChunks() {
  const pad = 700 / state.zoom;
  const a = screenToWorld(-pad, -pad);
  const b = screenToWorld(innerWidth + pad, innerHeight + pad);
  const minX = clamp(Math.min(a.x, b.x), 0, CONFIG.worldSize);
  const minY = clamp(Math.min(a.y, b.y), 0, CONFIG.worldSize);
  const maxX = clamp(Math.max(a.x, b.x), 0, CONFIG.worldSize);
  const maxY = clamp(Math.max(a.y, b.y), 0, CONFIG.worldSize);
  return {
    minCx: Math.floor(minX / CONFIG.chunkSize),
    minCy: Math.floor(minY / CONFIG.chunkSize),
    maxCx: Math.floor(maxX / CONFIG.chunkSize),
    maxCy: Math.floor(maxY / CONFIG.chunkSize)
  };
}

async function loadVisible(force = false) {
  if (state.loading) return;
  const view = viewportChunks();
  const key = `${view.minCx},${view.minCy},${view.maxCx},${view.maxCy}`;
  if (!force && key === state.lastLoadKey) return;

  state.loading = true;
  state.lastLoadKey = key;
  setStatus('불러오는 중');

  try {
    const response = await fetch(`${CONFIG.apiUrl}?${new URLSearchParams(view)}`);
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    for (const stroke of data.strokes || []) state.strokes.set(stroke.id, stroke);
    $('loaded').textContent = state.strokes.size.toLocaleString();
    setStatus('온라인');
    render();
  } catch (error) {
    console.error(error);
    setStatus('오프라인/오류');
  } finally {
    state.loading = false;
  }
}

function simplify(points) {
  const output = [];
  let last = null;
  const minimumDistance = Math.max(1, 2 / state.zoom);
  for (const point of points) {
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minimumDistance) {
      output.push(point);
      last = point;
    }
  }
  return output;
}

async function saveStroke(points) {
  const body = {
    sessionId: state.sessionId,
    userName: $('name').value || 'anonymous',
    color: $('color').value,
    width: Number($('width').value),
    points: simplify(points).slice(0, 1024)
  };

  if (body.points.length < 2) return;

  try {
    const response = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await response.text());
    const saved = await response.json();
    state.strokes.set(saved.stroke.id, {
      id: saved.stroke.id,
      session_id: state.sessionId,
      user_name: body.userName,
      color: body.color,
      width: body.width,
      points: body.points,
      created_at: saved.stroke.created_at
    });
    $('loaded').textContent = state.strokes.size.toLocaleString();
    setStatus('저장됨');
  } catch (error) {
    console.error(error);
    setStatus('저장 실패');
  }
}

function drawGrid() {
  const step = CONFIG.chunkSize * state.zoom;
  if (step < 24) return;

  const leftTop = screenToWorld(0, 0);
  const rightBottom = screenToWorld(innerWidth, innerHeight);
  const startX = Math.floor(leftTop.x / CONFIG.chunkSize) * CONFIG.chunkSize;
  const startY = Math.floor(leftTop.y / CONFIG.chunkSize) * CONFIG.chunkSize;

  ctx.save();
  ctx.scale(state.dpr, state.dpr);
  ctx.strokeStyle = 'rgba(17, 24, 39, 0.055)';
  ctx.lineWidth = 1;

  for (let x = startX; x <= rightBottom.x; x += CONFIG.chunkSize) {
    const screen = worldToScreen(x, 0).x;
    ctx.beginPath();
    ctx.moveTo(screen, 0);
    ctx.lineTo(screen, innerHeight);
    ctx.stroke();
  }

  for (let y = startY; y <= rightBottom.y; y += CONFIG.chunkSize) {
    const screen = worldToScreen(0, y).y;
    ctx.beginPath();
    ctx.moveTo(0, screen);
    ctx.lineTo(innerWidth, screen);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStroke(stroke, preview = false) {
  const points = Array.isArray(stroke) ? stroke : stroke.points;
  if (!points || points.length < 2) return;

  ctx.save();
  ctx.scale(state.dpr, state.dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = preview ? $('color').value : stroke.color;
  ctx.lineWidth = Math.max(1, (preview ? Number($('width').value) : stroke.width) * state.zoom);
  ctx.beginPath();

  const first = worldToScreen(points[0].x, points[0].y);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const point = worldToScreen(points[i].x, points[i].y);
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function render() {
  state.cameraX = clamp(state.cameraX, 0, CONFIG.worldSize);
  state.cameraY = clamp(state.cameraY, 0, CONFIG.worldSize);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  for (const stroke of state.strokes.values()) drawStroke(stroke);
  if (state.activeStroke.length) drawStroke(state.activeStroke, true);
  updateHud();
  saveCamera();
}

function updateHud() {
  $('pos').textContent = `${Math.round(state.cameraX).toLocaleString()}, ${Math.round(state.cameraY).toLocaleString()}`;
  $('chunk').textContent = `${Math.floor(state.cameraX / CONFIG.chunkSize)}, ${Math.floor(state.cameraY / CONFIG.chunkSize)}`;
  $('zoom').textContent = `${state.zoom.toFixed(2)}x`;
}

function setStatus(value) {
  $('status').textContent = value;
}

function randomSpawn() {
  state.cameraX = Math.floor(Math.random() * CONFIG.worldSize);
  state.cameraY = Math.floor(Math.random() * CONFIG.worldSize);
  state.strokes.clear();
  state.lastLoadKey = '';
  $('loaded').textContent = '0';
  render();
  loadVisible(true);
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  state.panning = event.shiftKey || event.altKey || event.button === 1;
  state.lastPointer = { x: event.clientX, y: event.clientY };

  if (!state.panning) {
    state.drawing = true;
    state.activeStroke = [screenToWorld(event.clientX, event.clientY)];
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.lastPointer) return;

  if (state.panning) {
    state.cameraX -= (event.clientX - state.lastPointer.x) / state.zoom;
    state.cameraY -= (event.clientY - state.lastPointer.y) / state.zoom;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    render();
    loadVisible();
    return;
  }

  if (state.drawing) {
    state.activeStroke.push(screenToWorld(event.clientX, event.clientY));
    render();
  }
});

canvas.addEventListener('pointerup', async () => {
  if (state.drawing) await saveStroke(state.activeStroke);
  state.drawing = false;
  state.panning = false;
  state.lastPointer = null;
  state.activeStroke = [];
  render();
  loadVisible(true);
});

canvas.addEventListener('pointercancel', () => {
  state.drawing = false;
  state.panning = false;
  state.lastPointer = null;
  state.activeStroke = [];
  render();
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const before = screenToWorld(event.clientX, event.clientY);
  state.zoom = clamp(state.zoom * (event.deltaY < 0 ? 1.12 : 0.89), CONFIG.minZoom, CONFIG.maxZoom);
  const after = screenToWorld(event.clientX, event.clientY);
  state.cameraX += before.x - after.x;
  state.cameraY += before.y - after.y;
  render();
  loadVisible();
}, { passive: false });

window.addEventListener('keydown', (event) => {
  const speed = 320 / state.zoom;
  if (event.key === 'ArrowUp') state.cameraY -= speed;
  if (event.key === 'ArrowDown') state.cameraY += speed;
  if (event.key === 'ArrowLeft') state.cameraX -= speed;
  if (event.key === 'ArrowRight') state.cameraX += speed;
  render();
  loadVisible();
});

$('spawn').addEventListener('click', randomSpawn);
$('clearLocal').addEventListener('click', () => {
  state.strokes.clear();
  state.lastLoadKey = '';
  $('loaded').textContent = '0';
  render();
  loadVisible(true);
});
$('copy').addEventListener('click', async () => {
  const text = `${Math.round(state.cameraX)},${Math.round(state.cameraY)}`;
  await navigator.clipboard.writeText(text);
  setStatus('좌표 복사됨');
});

resize();
window.addEventListener('resize', resize);
loadVisible(true);
window.setInterval(() => loadVisible(true), CONFIG.syncIntervalMs);
