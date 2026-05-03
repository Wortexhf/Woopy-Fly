// CONFIG завантажується з Django через /api/config/
const CONFIG = {};

// Promise який резолвиться коли ключі завантажені
window.configReady = fetch('/api/config/')
  .then(r => r.json())
  .then(data => {
    CONFIG.YOUTUBE_API_KEY       = data.youtube_api_key       || '';
    CONFIG.SPOTIFY_CLIENT_ID     = data.spotify_client_id     || '';
    CONFIG.SPOTIFY_CLIENT_SECRET = data.spotify_client_secret || '';
  })
  .catch(e => console.warn('Config load failed', e));
