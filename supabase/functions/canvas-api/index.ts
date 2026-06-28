import { createClient } from 'npm:@supabase/supabase-js@2';

const WORLD_SIZE = 1_000_000_000;
const CHUNK_SIZE = 512;
const MAX_POINTS = 1024;
const MAX_VIEW_CHUNKS = 64;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function isHexColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function validPoint(point: unknown): point is { x: number; y: number } {
  if (!point || typeof point !== 'object') return false;
  const raw = point as Record<string, unknown>;
  const x = Number(raw.x);
  const y = Number(raw.y);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= WORLD_SIZE && y <= WORLD_SIZE;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Supabase environment variables missing' }, 500);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const minCx = clampInt(url.searchParams.get('minCx'), -2_000_000, 2_000_000, 0);
    const minCy = clampInt(url.searchParams.get('minCy'), -2_000_000, 2_000_000, 0);
    const maxCxRaw = clampInt(url.searchParams.get('maxCx'), -2_000_000, 2_000_000, minCx + 10);
    const maxCyRaw = clampInt(url.searchParams.get('maxCy'), -2_000_000, 2_000_000, minCy + 10);
    const maxCx = Math.min(maxCxRaw, minCx + MAX_VIEW_CHUNKS);
    const maxCy = Math.min(maxCyRaw, minCy + MAX_VIEW_CHUNKS);

    const { data, error } = await db
      .from('strokes')
      .select('id,session_id,user_name,color,width,points,min_x,min_y,max_x,max_y,created_at')
      .lte('min_chunk_x', maxCx)
      .gte('max_chunk_x', minCx)
      .lte('min_chunk_y', maxCy)
      .gte('max_chunk_y', minCy)
      .order('id', { ascending: false })
      .limit(1000);

    if (error) return json({ error: error.message }, 500);
    return json({ strokes: (data ?? []).reverse(), worldSize: WORLD_SIZE, chunkSize: CHUNK_SIZE });
  }

  if (request.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const pointsRaw = body.points;
    if (!Array.isArray(pointsRaw) || pointsRaw.length < 2 || pointsRaw.length > MAX_POINTS) {
      return json({ error: 'points must contain 2..1024 items' }, 400);
    }
    if (!pointsRaw.every(validPoint)) return json({ error: 'Invalid point coordinates' }, 400);

    const points = pointsRaw.map((point) => ({
      x: Math.round(Number(point.x)),
      y: Math.round(Number(point.y))
    }));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const min_x = Math.min(...xs);
    const min_y = Math.min(...ys);
    const max_x = Math.max(...xs);
    const max_y = Math.max(...ys);
    const width = clampInt(body.width, 1, 40, 4);
    const color = isHexColor(body.color) ? String(body.color) : '#111111';
    const user_name = String(body.userName ?? 'anonymous').slice(0, 32).replace(/[<>]/g, '');
    const session_id = typeof body.sessionId === 'string' && /^[0-9a-fA-F-]{36}$/.test(body.sessionId)
      ? body.sessionId
      : crypto.randomUUID();

    const { data, error } = await db
      .from('strokes')
      .insert({
        session_id,
        user_name,
        color,
        width,
        points,
        min_x,
        min_y,
        max_x,
        max_y,
        min_chunk_x: Math.floor(min_x / CHUNK_SIZE),
        min_chunk_y: Math.floor(min_y / CHUNK_SIZE),
        max_chunk_x: Math.floor(max_x / CHUNK_SIZE),
        max_chunk_y: Math.floor(max_y / CHUNK_SIZE)
      })
      .select('id,created_at')
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, stroke: data }, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
});
