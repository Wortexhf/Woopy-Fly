from django.contrib import admin
from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from main import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.index_page),

    # Tracks
    path('api/config/', views.api_config),
    path('api/ytdlp/<str:video_id>/', views.api_ytdlp_stream),
    path('api/tracks/', views.api_tracks),
    path('api/tracks/upload/', views.api_track_upload),
    path('api/tracks/external/', views.api_track_external),
    path('api/tracks/<int:track_id>/delete/', views.api_track_delete),
    path('api/tracks/<int:track_id>/like/', views.api_toggle_like),

    # Liked
    path('api/liked/', views.api_liked),

    # Playlists
    path('api/playlists/', views.api_playlists),
    path('api/playlists/create/', views.api_playlist_create),
    path('api/playlists/<int:playlist_id>/delete/', views.api_playlist_delete),
    path('api/playlists/<int:playlist_id>/tracks/', views.api_playlist_tracks),
    path('api/playlists/<int:playlist_id>/tracks/<int:track_id>/', views.api_playlist_add_track),
    path('api/playlists/<int:playlist_id>/tracks/<int:track_id>/remove/', views.api_playlist_remove_track),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

