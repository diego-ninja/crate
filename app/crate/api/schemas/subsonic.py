"""Schemas for the Open Subsonic-compatible API."""

from pydantic import BaseModel, ConfigDict, Field


class _SubsonicModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")


class SubsonicErrorDetail(_SubsonicModel):
    code: int
    message: str


class SubsonicResponseBase(_SubsonicModel):
    status: str
    version: str
    type: str
    server_version: str = Field(alias="serverVersion")
    error: SubsonicErrorDetail | None = None


class SubsonicEnvelopeBase(_SubsonicModel):
    pass


class SubsonicLicense(_SubsonicModel):
    valid: bool
    email: str
    license_expires: str = Field(alias="licenseExpires")


class SubsonicMusicFolder(_SubsonicModel):
    id: int
    name: str


class SubsonicMusicFolders(_SubsonicModel):
    music_folder: list[SubsonicMusicFolder] = Field(alias="musicFolder")


class SubsonicUser(_SubsonicModel):
    username: str
    email: str
    admin_role: bool = Field(alias="adminRole")
    scrobbling_enabled: bool = Field(alias="scrobblingEnabled")
    settings_role: bool = Field(alias="settingsRole")
    download_role: bool = Field(alias="downloadRole")
    upload_role: bool = Field(alias="uploadRole")
    playlist_role: bool = Field(alias="playlistRole")
    cover_art_role: bool = Field(alias="coverArtRole")
    comment_role: bool = Field(alias="commentRole")
    podcast_role: bool = Field(alias="podcastRole")
    stream_role: bool = Field(alias="streamRole")
    jukebox_role: bool = Field(alias="jukeboxRole")
    share_role: bool = Field(alias="shareRole")


class SubsonicArtist(_SubsonicModel):
    id: str
    name: str
    album_count: int | None = Field(default=None, alias="albumCount")


class SubsonicArtistIndex(_SubsonicModel):
    name: str
    artist: list[SubsonicArtist]


class SubsonicArtists(_SubsonicModel):
    ignored_articles: str | None = Field(default=None, alias="ignoredArticles")
    index: list[SubsonicArtistIndex]


class SubsonicAlbum(_SubsonicModel):
    id: str
    name: str
    artist: str | None = None
    artist_id: str | None = Field(default=None, alias="artistId")
    year: int | None = None
    song_count: int | None = Field(default=None, alias="songCount")
    duration: float | None = None
    cover_art: str | None = Field(default=None, alias="coverArt")


class SubsonicSong(_SubsonicModel):
    id: str
    title: str
    artist: str
    album: str
    album_id: str | None = Field(default=None, alias="albumId")
    artist_id: str | None = Field(default=None, alias="artistId")
    track: int | None = None
    disc_number: int | None = Field(default=None, alias="discNumber")
    year: int | None = None
    duration: float | None = None
    bit_rate: int | None = Field(default=None, alias="bitRate")
    suffix: str | None = None
    content_type: str | None = Field(default=None, alias="contentType")
    path: str | None = None
    cover_art: str | None = Field(default=None, alias="coverArt")
    type: str | None = None


class SubsonicArtistDetail(_SubsonicModel):
    id: str
    name: str
    album_count: int = Field(alias="albumCount")
    album: list[SubsonicAlbum]


class SubsonicAlbumDetail(_SubsonicModel):
    id: str
    name: str
    artist: str
    artist_id: str | None = Field(default=None, alias="artistId")
    year: int | None = None
    song_count: int = Field(alias="songCount")
    duration: float | None = None
    cover_art: str | None = Field(default=None, alias="coverArt")
    song: list[SubsonicSong]


class SubsonicSearchResult3(_SubsonicModel):
    artist: list[SubsonicArtist]
    album: list[SubsonicAlbum]
    song: list[SubsonicSong]


class SubsonicPlaylists(_SubsonicModel):
    playlist: list[dict[str, object]]


class SubsonicStarred2(_SubsonicModel):
    artist: list[SubsonicArtist]
    album: list[SubsonicAlbum]
    song: list[SubsonicSong]


class SubsonicRandomSongs(_SubsonicModel):
    song: list[SubsonicSong]


class SubsonicOkBody(SubsonicResponseBase):
    pass


class SubsonicOkResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicOkBody = Field(alias="subsonic-response")


class SubsonicLicenseBody(SubsonicResponseBase):
    license: SubsonicLicense | None = None


class SubsonicLicenseResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicLicenseBody = Field(alias="subsonic-response")


class SubsonicMusicFoldersBody(SubsonicResponseBase):
    music_folders: SubsonicMusicFolders | None = Field(default=None, alias="musicFolders")


class SubsonicMusicFoldersResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicMusicFoldersBody = Field(alias="subsonic-response")


class SubsonicUserBody(SubsonicResponseBase):
    user: SubsonicUser | None = None


class SubsonicUserResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicUserBody = Field(alias="subsonic-response")


class SubsonicArtistsBody(SubsonicResponseBase):
    artists: SubsonicArtists | None = None


class SubsonicArtistsResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicArtistsBody = Field(alias="subsonic-response")


class SubsonicArtistBody(SubsonicResponseBase):
    artist: SubsonicArtistDetail | None = None


class SubsonicArtistResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicArtistBody = Field(alias="subsonic-response")


class SubsonicAlbumBody(SubsonicResponseBase):
    album: SubsonicAlbumDetail | None = None


class SubsonicAlbumResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicAlbumBody = Field(alias="subsonic-response")


class SubsonicSongBody(SubsonicResponseBase):
    song: SubsonicSong | None = None


class SubsonicSongResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicSongBody = Field(alias="subsonic-response")


class SubsonicAlbumList2(_SubsonicModel):
    album: list[SubsonicAlbum]


class SubsonicAlbumList2Body(SubsonicResponseBase):
    album_list2: SubsonicAlbumList2 | None = Field(default=None, alias="albumList2")


class SubsonicAlbumList2Response(SubsonicEnvelopeBase):
    subsonic_response: SubsonicAlbumList2Body = Field(alias="subsonic-response")


class SubsonicSearchResult3Body(SubsonicResponseBase):
    search_result3: SubsonicSearchResult3 | None = Field(default=None, alias="searchResult3")


class SubsonicSearchResult3Response(SubsonicEnvelopeBase):
    subsonic_response: SubsonicSearchResult3Body = Field(alias="subsonic-response")


class SubsonicPlaylistsBody(SubsonicResponseBase):
    playlists: SubsonicPlaylists | None = None


class SubsonicPlaylistsResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicPlaylistsBody = Field(alias="subsonic-response")


class SubsonicStarred2Body(SubsonicResponseBase):
    starred2: SubsonicStarred2 | None = None


class SubsonicStarred2Response(SubsonicEnvelopeBase):
    subsonic_response: SubsonicStarred2Body = Field(alias="subsonic-response")


class SubsonicRandomSongsBody(SubsonicResponseBase):
    random_songs: SubsonicRandomSongs | None = Field(default=None, alias="randomSongs")


class SubsonicRandomSongsResponse(SubsonicEnvelopeBase):
    subsonic_response: SubsonicRandomSongsBody = Field(alias="subsonic-response")
