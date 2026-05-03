from django.db import models


class Track(models.Model):
    SOURCE_FILE = 'file'
    SOURCE_YOUTUBE = 'youtube'
    SOURCE_SOUNDCLOUD = 'soundcloud'
    SOURCE_CHOICES = [
        (SOURCE_FILE, 'MP3 File'),
        (SOURCE_YOUTUBE, 'YouTube'),
        (SOURCE_SOUNDCLOUD, 'SoundCloud'),
    ]

    title = models.CharField(max_length=255)
    artist = models.CharField(max_length=255, blank=True, default='')
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_FILE)

    # Для MP3 файлів
    audio_file = models.FileField(upload_to='tracks/', null=True, blank=True)

    # Для YouTube/SoundCloud — зберігаємо URL
    external_url = models.URLField(blank=True, default='')

    # Обкладинка
    cover = models.ImageField(upload_to='covers/', null=True, blank=True)
    cover_url = models.URLField(blank=True, default='')

    duration = models.CharField(max_length=10, blank=True, default='0:00')
    created_at = models.DateTimeField(auto_now_add=True)

    def get_cover(self):
        if self.cover:
            return self.cover.url
        if self.cover_url:
            return self.cover_url
        return ''

    def to_dict(self, liked=False):
        return {
            'id': self.pk,
            'title': self.title,
            'artist': self.artist,
            'source': self.source,
            'audio_url': self.audio_file.url if self.audio_file else '',
            'external_url': self.external_url,
            'cover': self.get_cover(),
            'duration': self.duration,
            'liked': liked,
        }

    def __str__(self):
        return f'{self.artist} – {self.title}'

    class Meta:
        ordering = ['-created_at']


class Playlist(models.Model):
    name = models.CharField(max_length=255)
    emoji = models.CharField(max_length=8, default='🎵')
    tracks = models.ManyToManyField(Track, through='PlaylistTrack', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def to_dict(self):
        return {
            'id': self.pk,
            'name': self.name,
            'emoji': self.emoji,
            'track_count': self.tracks.count(),
        }

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']


class PlaylistTrack(models.Model):
    playlist = models.ForeignKey(Playlist, on_delete=models.CASCADE)
    track = models.ForeignKey(Track, on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'added_at']
        unique_together = ('playlist', 'track')


class LikedTrack(models.Model):
    track = models.OneToOneField(Track, on_delete=models.CASCADE, related_name='like')
    liked_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'♥ {self.track}'

    class Meta:
        ordering = ['-liked_at']
