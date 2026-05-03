import json
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import Track, Playlist, PlaylistTrack, LikedTrack


def _get_mp3_duration(file_obj):
    """Читає тривалість MP3 через mutagen."""
    try:
        from mutagen.mp3 import MP3
        from mutagen import MutagenError
        audio = MP3(file_obj)
        total = int(audio.info.length)
        return f"{total // 60}:{total % 60:02d}"
    except Exception:
        return '0:00'


def index_page(request):
    return render(request, 'main/index.html')


# ─── Tracks ───────────────────────────────────────────────────────────────────

def api_tracks(request):
    """GET /api/tracks/ — всі треки з прапором liked"""
    liked_ids = set(LikedTrack.objects.values_list('track_id', flat=True))
    tracks = Track.objects.all()
    return JsonResponse([t.to_dict(liked=t.pk in liked_ids) for t in tracks], safe=False)


@csrf_exempt
def api_track_upload(request):
    """POST /api/tracks/upload/ — завантажити MP3 трек"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    title      = request.POST.get('title', '').strip()
    artist     = request.POST.get('artist', '').strip()
    audio_file = request.FILES.get('audio_file')
    cover_file = request.FILES.get('cover_file')

    if not title:
        return JsonResponse({'error': 'title is required'}, status=400)
    if not audio_file:
        return JsonResponse({'error': 'audio_file is required'}, status=400)

    # Автоматично читаємо тривалість з MP3
    duration = _get_mp3_duration(audio_file)
    audio_file.seek(0)  # повертаємо вказівник після читання

    track = Track.objects.create(
        title=title,
        artist=artist,
        source=Track.SOURCE_FILE,
        audio_file=audio_file,
        cover=cover_file if cover_file else None,
        duration=duration,
    )
    return JsonResponse(track.to_dict(), status=201)


@csrf_exempt
def api_track_external(request):
    """POST /api/tracks/external/ — додати SoundCloud / YouTube / Spotify трек"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    title        = request.POST.get('title', '').strip()
    artist       = request.POST.get('artist', '').strip()
    external_url = request.POST.get('external_url', '').strip()
    source       = request.POST.get('source', Track.SOURCE_SOUNDCLOUD)
    cover_file   = request.FILES.get('cover_file')
    cover_url    = request.POST.get('cover_url', '').strip()
    duration     = request.POST.get('duration', '0:00').strip() or '0:00'

    if not title or not external_url:
        return JsonResponse({'error': 'title and external_url are required'}, status=400)

    track = Track.objects.create(
        title=title,
        artist=artist,
        source=source,
        external_url=external_url,
        cover=cover_file if cover_file else None,
        cover_url=cover_url,
        duration=duration,
    )
    return JsonResponse(track.to_dict(), status=201)


@csrf_exempt
def api_track_delete(request, track_id):
    """DELETE /api/tracks/<id>/delete/"""
    if request.method != 'DELETE':
        return JsonResponse({'error': 'DELETE required'}, status=405)
    track = get_object_or_404(Track, pk=track_id)
    track.delete()
    return JsonResponse({'deleted': track_id})


# ─── Likes ────────────────────────────────────────────────────────────────────

def api_liked(request):
    """GET /api/liked/ — всі лайкнуті треки"""
    liked = LikedTrack.objects.select_related('track').all()
    return JsonResponse([lt.track.to_dict(liked=True) for lt in liked], safe=False)


@csrf_exempt
def api_toggle_like(request, track_id):
    """POST /api/tracks/<id>/like/ — лайкнути або розлайкнути"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    track = get_object_or_404(Track, pk=track_id)
    liked_obj, created = LikedTrack.objects.get_or_create(track=track)
    if not created:
        liked_obj.delete()
        return JsonResponse({'liked': False, 'track_id': track_id})
    return JsonResponse({'liked': True, 'track_id': track_id})


# ─── Playlists ────────────────────────────────────────────────────────────────

def api_playlists(request):
    """GET /api/playlists/ — всі плейлисти"""
    playlists = Playlist.objects.all()
    return JsonResponse([p.to_dict() for p in playlists], safe=False)


@csrf_exempt
def api_playlist_create(request):
    """POST /api/playlists/ — створити плейлист"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    name = data.get('name', '').strip()
    emoji = data.get('emoji', '🎵').strip() or '🎵'
    if not name:
        return JsonResponse({'error': 'name is required'}, status=400)

    playlist = Playlist.objects.create(name=name, emoji=emoji)
    return JsonResponse(playlist.to_dict(), status=201)


@csrf_exempt
def api_playlist_delete(request, playlist_id):
    """DELETE /api/playlists/<id>/"""
    if request.method != 'DELETE':
        return JsonResponse({'error': 'DELETE required'}, status=405)
    playlist = get_object_or_404(Playlist, pk=playlist_id)
    playlist.delete()
    return JsonResponse({'deleted': playlist_id})


def api_playlist_tracks(request, playlist_id):
    """GET /api/playlists/<id>/tracks/ — треки плейлиста"""
    playlist = get_object_or_404(Playlist, pk=playlist_id)
    liked_ids = set(LikedTrack.objects.values_list('track_id', flat=True))
    tracks = playlist.tracks.all()
    return JsonResponse({
        'playlist': playlist.to_dict(),
        'tracks': [t.to_dict(liked=t.pk in liked_ids) for t in tracks],
    })


@csrf_exempt
def api_playlist_add_track(request, playlist_id, track_id):
    """POST /api/playlists/<id>/tracks/<track_id>/ — додати трек до плейлиста"""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    playlist = get_object_or_404(Playlist, pk=playlist_id)
    track = get_object_or_404(Track, pk=track_id)
    _, created = PlaylistTrack.objects.get_or_create(playlist=playlist, track=track)
    return JsonResponse({'added': created, 'playlist': playlist.to_dict()})


@csrf_exempt
def api_playlist_remove_track(request, playlist_id, track_id):
    """DELETE /api/playlists/<id>/tracks/<track_id>/"""
    if request.method != 'DELETE':
        return JsonResponse({'error': 'DELETE required'}, status=405)
    PlaylistTrack.objects.filter(
        playlist_id=playlist_id, track_id=track_id
    ).delete()
    return JsonResponse({'removed': True})



# ─── Config endpoint ──────────────────────────────────────────
from django.conf import settings as django_settings

def api_config(request):
    """GET /api/config/ — повертає публічні ключі для фронтенду"""
    return JsonResponse({
        'youtube_api_key':       django_settings.YOUTUBE_API_KEY,
        'spotify_client_id':     django_settings.SPOTIFY_CLIENT_ID,
        'spotify_client_secret': django_settings.SPOTIFY_CLIENT_SECRET,
    })


# ─── yt-dlp stream ────────────────────────────────────────────
import subprocess, tempfile, os, threading
from django.http import StreamingHttpResponse, HttpResponseBadRequest, HttpResponseServerError

def api_ytdlp_stream(request, video_id):
    """
    GET /api/ytdlp/<video_id>/
    Скачує аудіо через yt-dlp в /tmp і стримить як MP3.
    """
    if not video_id or len(video_id) > 20:
        return HttpResponseBadRequest('Invalid video id')

    tmp_dir  = tempfile.mkdtemp()
    out_tmpl = os.path.join(tmp_dir, '%(id)s.%(ext)s')

    # Спробуємо кілька комбінацій — від найкращої до fallback
    strategies = [
        # 1. Cookies з Chrome — обходить вікову перевірку і більшість блокувань
        ['--cookies-from-browser', 'chrome',
         '--extractor-args', 'youtube:player_client=tv_embedded'],
        # 2. Firefox cookies
        ['--cookies-from-browser', 'firefox',
         '--extractor-args', 'youtube:player_client=tv_embedded'],
        # 3. TV embedded без cookies
        ['--extractor-args', 'youtube:player_client=tv_embedded'],
        # 4. Android
        ['--extractor-args', 'youtube:player_client=android'],
    ]

    import logging
    last_err = ''
    result   = None

    try:
        for strategy in strategies:
            result = subprocess.run([
                'yt-dlp', '--no-playlist', '-x',
                '--audio-format', 'mp3', '--audio-quality', '5',
                '--no-cache-dir', '--no-check-certificates',
                *strategy,
                '-o', out_tmpl,
                f'https://www.youtube.com/watch?v={video_id}',
            ], capture_output=True, text=True, timeout=120)

            if result.returncode == 0:
                break

            last_err = result.stderr
            for line in last_err.splitlines():
                if 'ERROR:' in line:
                    last_err = line
                    break

        if result is None or result.returncode != 0:
            logging.error(f'yt-dlp failed {video_id}: {last_err}')
            return HttpResponseServerError(f'yt-dlp: {last_err[:200]}')

        mp3_path = os.path.join(tmp_dir, f'{video_id}.mp3')
        if not os.path.exists(mp3_path):
            files = os.listdir(tmp_dir)
            if not files:
                return HttpResponseServerError('No output file')
            mp3_path = os.path.join(tmp_dir, files[0])

        file_size = os.path.getsize(mp3_path)

        def file_iterator(path, chunk_size=65536):
            try:
                with open(path, 'rb') as f:
                    while True:
                        chunk = f.read(chunk_size)
                        if not chunk:
                            break
                        yield chunk
            finally:
                try:
                    os.remove(path)
                    os.rmdir(tmp_dir)
                except Exception:
                    pass

        response = StreamingHttpResponse(file_iterator(mp3_path), content_type='audio/mpeg')
        response['Content-Length']              = file_size
        response['Content-Disposition']         = f'inline; filename="{video_id}.mp3"'
        response['Accept-Ranges']               = 'bytes'
        response['Cache-Control']               = 'no-cache'
        response['Access-Control-Allow-Origin'] = '*'
        return response

    except subprocess.TimeoutExpired:
        return HttpResponseServerError('yt-dlp timeout')
    except Exception as e:
        return HttpResponseServerError(str(e)[:200])

