export type PlaybackMode = 'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle';
export type CardStyle = 'original' | 'cover';
export type LyricLine = { time: number; text: string };
export interface Track {
  id: string;
  providerId: string;
  sourceId: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number;
  duration: number;
  format: string;
  fileName: string;
  folder: string;
  size: number;
  modified: number;
  cover?: Blob;
  coverUrl?: string;
  albumId?: string;
  playbackNotice?: string;
  lyrics?: string;
  handle?: FileSystemFileHandle;
  desktopFile?: { path: string; size: number; modified: number };
  rootId?: string;
  relativePath?: string;
  availability: 'ready' | 'permission' | 'missing' | 'temporary';
}
export interface Collection {
  id: string;
  name: string;
  kind: 'album' | 'playlist' | 'builtin';
  trackIds: string[];
  providerId?: string;
  sourceId?: string;
  accountId?: string;
  readOnly?: boolean;
}
export interface QueueEntry { id: string; trackId: string }
export interface PlaybackState {
  queue: QueueEntry[];
  currentEntryId: string | null;
  position: number;
  volume: number;
  mode: PlaybackMode;
}
export interface MusicPreferences {
  theme: 'light' | 'dark';
  cardStyle: CardStyle;
  rhythm: boolean;
  sound: boolean;
  soundVolume: number;
  backgroundMusic: boolean;
  intro: 'first' | 'always' | 'short';
  seenIntro: boolean;
  reduced: boolean;
  quality: 'performance' | 'original' | 'high' | 'ultra';
  rendering?: import('../render-quality').RenderQuality;
  collectionMode: 'albums' | 'playlists';
  closeToTray?: boolean;
}
export interface LibrarySnapshot {
  roots?: { id: string; handle: FileSystemDirectoryHandle }[];
  tracks: Track[];
  playlists: Collection[];
  favorites: string[];
  playback: PlaybackState;
  preferences: MusicPreferences;
}
export interface MediaResource { url: string; crossOrigin?: 'anonymous'; notice?: string; release(): void }
export interface MusicProvider {
  readonly id: string;
  search(query: string, signal?: AbortSignal): Promise<Track[]>;
  resolveMedia(track: Track, signal?: AbortSignal): Promise<MediaResource>;
  getCover(track: Track, signal?: AbortSignal): Promise<Blob | undefined>;
  getLyrics(track: Track, signal?: AbortSignal): Promise<string | undefined>;
}
export interface FileAccessAdapter {
  read(track: Track): Promise<File>;
  requestAccess(track: Track): Promise<boolean>;
  resolveMedia?(track: Track, signal?: AbortSignal): Promise<MediaResource>;
}
export type TrackMetadata = Partial<Pick<Track, 'title' | 'artist' | 'album' | 'albumArtist' | 'trackNumber' | 'duration' | 'format' | 'cover'>>;
export interface LibraryFileAccess extends FileAccessAdapter {
  readonly temporary: Map<string, File>;
  refreshAvailability(tracks: Track[]): Promise<void>;
  choose?(directory: boolean): Promise<ImportItem[]>;
  parse?(item: ImportItem): Promise<TrackMetadata>;
  cancelImport?(): void;
}
export type ImportItem = { file: File; handle?: FileSystemFileHandle; rootId?: string; relativePath: string; desktopFile?: Track['desktopFile'] };
export type ImportProgress = { completed: number; total: number; name: string; failed: number; canceled: boolean };
