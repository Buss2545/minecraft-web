import { getDatabase } from './db.js';

const MUSIC_BUCKET = 'musicFiles';
const CHUNK_SIZE = 255 * 1024;
const MAX_UPLOAD = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function publicTrack(track) {
  return {
    id: track.id,
    title: track.title || track.filename || 'เพลงไม่ทราบชื่อ',
    artist: track.artist || 'Mari Music',
    filename: track.filename || '',
    mimeType: track.mimeType || 'audio/mpeg',
    size: Number(track.size || 0),
    uploadedAt: track.uploadedAt || null,
    order: Number(track.order || 0),
    streamUrl: `/api/music/tracks/${encodeURIComponent(track.id)}/stream`
  };
}

function adminOK(request, env) {
  const expected = String(env?.ADMIN_KEY || '').trim();
  const supplied = String(request.headers.get('x-admin-key') || '').trim();
  return !!expected && supplied === expected;
}

function binaryBytes(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  try {
    if (typeof value.value === 'function') {
      const out = value.value(true);
      if (out instanceof Uint8Array) return out;
      return new Uint8Array(out);
    }
  } catch (_) {}
  if (value.buffer) {
    try { return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.buffer.byteLength); } catch (_) {}
  }
  return new Uint8Array(value);
}

function base64Bytes(input) {
  const raw = String(input || '');
  const comma = raw.indexOf(',');
  const b64 = comma >= 0 ? raw.slice(comma + 1) : raw;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function saveGridFS(db, id, bytes, filename, mimeType, metadata) {
  const files = db.collection(`${MUSIC_BUCKET}.files`);
  const chunks = db.collection(`${MUSIC_BUCKET}.chunks`);
  const now = new Date();
  const fileDoc = {
    _id: id,
    length: bytes.byteLength,
    chunkSize: CHUNK_SIZE,
    uploadDate: now,
    filename,
    contentType: mimeType,
    metadata
  };
  await files.insertOne(fileDoc);
  try {
    const docs = [];
    for (let offset = 0, n = 0; offset < bytes.length; offset += CHUNK_SIZE, n++) {
      const end = Math.min(offset + CHUNK_SIZE, bytes.length);
      docs.push({ files_id: id, n, data: Buffer.from(bytes.slice(offset, end)) });
      if (docs.length >= 20) {
        await chunks.insertMany(docs, { ordered: true });
        docs.length = 0;
      }
    }
    if (docs.length) await chunks.insertMany(docs, { ordered: true });
  } catch (error) {
    await chunks.deleteMany({ files_id: id }).catch(() => {});
    await files.deleteOne({ _id: id }).catch(() => {});
    throw error;
  }
}

async function deleteGridFS(db, id) {
  if (!id) return;
  await db.collection(`${MUSIC_BUCKET}.chunks`).deleteMany({ files_id: id }).catch(() => {});
  await db.collection(`${MUSIC_BUCKET}.files`).deleteOne({ _id: id }).catch(() => {});
}

async function streamTrack(request, env, track) {
  const db = await getDatabase(env);
  const file = await db.collection(`${MUSIC_BUCKET}.files`).findOne({ _id: track.gridFsId });
  if (!file) return json({ error: 'ไม่พบไฟล์เพลงนี้ในพื้นที่จัดเก็บ' }, 404);

  const total = Number(file.length || track.size || 0);
  if (!total) return new Response(null, { status: 404 });
  const chunkSize = Number(file.chunkSize || CHUNK_SIZE);
  const rangeHeader = String(request.headers.get('range') || '');
  let start = 0;
  let end = total - 1;
  let partial = false;

  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    partial = true;
    if (match[1]) start = Number(match[1]);
    if (match[2]) end = Number(match[2]);
    else end = total - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      if (suffix > 0) { start = Math.max(total - suffix, 0); end = total - 1; }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || start > end) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    }
    end = Math.min(end, total - 1);
  }

  const firstChunk = Math.floor(start / chunkSize);
  const lastChunk = Math.floor(end / chunkSize);
  const cursor = db.collection(`${MUSIC_BUCKET}.chunks`).find({
    files_id: file._id,
    n: { $gte: firstChunk, $lte: lastChunk }
  }).sort({ n: 1 });

  let cursorReady = false;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        if (!cursorReady) cursorReady = true;
        const result = await cursor.next();
        if (!result) { await cursor.close(); controller.close(); return; }
        const bytes = binaryBytes(result.data);
        const chunkStart = Number(result.n) * chunkSize;
        const from = Math.max(start - chunkStart, 0);
        const to = Math.min(end - chunkStart + 1, bytes.byteLength);
        if (to > from) controller.enqueue(bytes.slice(from, to));
        if (Number(result.n) >= lastChunk) { await cursor.close(); controller.close(); }
      } catch (error) {
        await cursor.close().catch(() => {});
        controller.error(error);
      }
    },
    cancel() { return cursor.close().catch(() => {}); }
  });

  const headers = new Headers({
    'content-type': track.mimeType || file.contentType || 'audio/mpeg',
    'accept-ranges': 'bytes',
    'content-length': String(end - start + 1),
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
    'cache-control': 'public, max-age=3600'
  });
  if (partial) headers.set('content-range', `bytes ${start}-${end}/${total}`);
  return new Response(body, { status: partial ? 206 : 200, headers });
}

export async function handleMusic(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/music') && !url.pathname.startsWith('/api/admin/music')) return null;

  try {
    const db = await getDatabase(env);
    const tracks = db.collection('musicTracks');

    if (url.pathname === '/api/music/tracks' && request.method === 'GET') {
      const rows = await tracks.find({ active: { $ne: false } }).sort({ order: 1, uploadedAt: -1 }).limit(200).toArray();
      return json({ tracks: rows.map(publicTrack) });
    }

    const streamMatch = url.pathname.match(/^\/api\/music\/tracks\/([^/]+)\/stream$/);
    if (streamMatch && request.method === 'GET') {
      const id = decodeURIComponent(streamMatch[1]);
      const track = await tracks.findOne({ id, active: { $ne: false } });
      if (!track || !track.gridFsId) return json({ error: 'ไม่พบเพลงนี้' }, 404);
      return streamTrack(request, env, track);
    }

    if (url.pathname === '/api/admin/music' && request.method === 'POST') {
      if (!adminOK(request, env)) return json({ error: 'ไม่มีสิทธิ์ผู้ดูแล' }, 403);
      const body = await request.json().catch(() => ({}));
      const title = String(body?.title || '').trim().slice(0, 120);
      const artist = String(body?.artist || '').trim().slice(0, 120);
      const filename = String(body?.filename || 'track.mp3').trim().slice(0, 180);
      const mimeType = String(body?.mimeType || 'audio/mpeg').toLowerCase();
      if (!title) return json({ error: 'กรุณาระบุชื่อเพลง' }, 400);
      if (!ALLOWED_MIME.has(mimeType)) return json({ error: 'รองรับเฉพาะ MP3, OGG หรือ WAV' }, 400);
      const bytes = base64Bytes(body?.data);
      if (!bytes.length || bytes.length > MAX_UPLOAD) return json({ error: 'ไฟล์เพลงต้องมีขนาด 1-15 MB' }, 400);
      const trackId = 'MUSIC-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      const gridFsId = crypto.randomUUID();
      const last = await tracks.findOne({}, { sort: { order: -1 } });
      await saveGridFS(db, gridFsId, bytes, filename, mimeType, { trackId, title, artist });
      const track = { id: trackId, title, artist, filename, mimeType, size: bytes.length, gridFsId, order: last ? Number(last.order || 0) + 1 : 0, active: true, uploadedAt: new Date().toISOString() };
      try { await tracks.insertOne(track); } catch (error) { await deleteGridFS(db, gridFsId); throw error; }
      return json({ success: true, track: publicTrack(track) });
    }

    if (url.pathname === '/api/admin/music/order' && (request.method === 'POST' || request.method === 'PATCH')) {
      if (!adminOK(request, env)) return json({ error: 'ไม่มีสิทธิ์ผู้ดูแล' }, 403);
      const body = await request.json().catch(() => ({}));
      const orders = Array.isArray(body?.orders) ? body.orders : [];
      for (let i = 0; i < orders.length; i++) {
        const id = String(orders[i]?.id || '').trim();
        if (id) await tracks.updateOne({ id }, { $set: { order: i } });
      }
      return json({ success: true });
    }

    const deleteMatch = url.pathname.match(/^\/api\/admin\/music\/([^/]+)$/);
    if (deleteMatch && request.method === 'DELETE') {
      if (!adminOK(request, env)) return json({ error: 'ไม่มีสิทธิ์ผู้ดูแล' }, 403);
      const id = decodeURIComponent(deleteMatch[1]);
      const track = await tracks.findOne({ id });
      if (!track) return json({ error: 'ไม่พบเพลงนี้' }, 404);
      await tracks.deleteOne({ id });
      await deleteGridFS(db, track.gridFsId);
      return json({ success: true, track: publicTrack(track) });
    }

    return null;
  } catch (error) {
    console.error('[cloudflare-music]', error);
    return json({ error: `ระบบเพลงขัดข้องชั่วคราว (worker:${String(error?.message || error)})` }, 500);
  }
}
