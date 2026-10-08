import type { LibrarySnapshot, MusicPreferences, PlaybackState } from './types.ts';

export const defaultPlayback = (): PlaybackState => ({ queue: [], currentEntryId: null, position: 0, volume: .75, mode: 'sequence' });
export const defaultPreferences = (): MusicPreferences => ({ theme: 'light', cardStyle: 'original', rhythm: true, sound: true, soundVolume: .25, backgroundMusic: false, intro: 'first', seenIntro: false, reduced: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, quality: 'original', collectionMode: 'albums' });

export class MusicDatabase {
  private db?: IDBDatabase;
  close() { this.db?.close(); this.db = undefined; }
  async open() {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rhine-music-library', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('state'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('音乐库正在另一个窗口更新，请关闭旧窗口后重试。'));
    });
    this.db.onversionchange = () => this.db?.close();
  }
  async load(): Promise<LibrarySnapshot> {
    if (!this.db) await this.open();
    const raw = await new Promise<Partial<LibrarySnapshot> | undefined>((resolve, reject) => {
      const request = this.db!.transaction('state').objectStore('state').get('library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { roots: raw?.roots ?? [], tracks: raw?.tracks ?? [], playlists: raw?.playlists ?? [], favorites: raw?.favorites ?? [], playback: { ...defaultPlayback(), ...raw?.playback }, preferences: { ...defaultPreferences(), ...raw?.preferences } };
  }
  async save(snapshot: LibrarySnapshot) {
    if (!this.db) await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction('state', 'readwrite');
      transaction.objectStore('state').put(snapshot, 'library');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('音乐库保存被中断'));
    });
  }
}
