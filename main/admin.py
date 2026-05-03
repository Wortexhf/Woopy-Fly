from django.contrib import admin
from .models import Track, Playlist, PlaylistTrack, LikedTrack


@admin.register(Track)
class TrackAdmin(admin.ModelAdmin):
    list_display = ('title', 'artist', 'source', 'duration', 'created_at')
    list_filter = ('source',)
    search_fields = ('title', 'artist')


@admin.register(Playlist)
class PlaylistAdmin(admin.ModelAdmin):
    list_display = ('emoji', 'name', 'track_count', 'created_at')

    def track_count(self, obj):
        return obj.tracks.count()
    track_count.short_description = 'Tracks'


@admin.register(LikedTrack)
class LikedTrackAdmin(admin.ModelAdmin):
    list_display = ('track', 'liked_at')


admin.site.register(PlaylistTrack)

