# Whitevoid Canvas

A very large online white canvas where users spawn at random coordinates and draw together.

## Design

- Virtual world size: `1,000,000,000 x 1,000,000,000 px`
- Tile/chunk size: `512 px`
- The white background is never stored.
- Only user strokes are saved.
- Frontend: Vite static app
- Backend: Supabase Edge Function `canvas-api`
- Database table: `public.strokes`

## Controls

- Drag: draw
- Shift or Alt + drag: pan
- Mouse wheel: zoom
- Arrow keys: move camera
- Random button: jump to a random spawn location

## Supabase

The included migration creates the `strokes` table and `canvas_stats` view. The deployed Edge Function URL is configured in `src/config.js`.
