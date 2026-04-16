declare module "@regosen/gapless-5" {
  interface Gapless5Options {
    tracks?: string | string[];
    loop?: boolean;
    singleMode?: boolean;
    exclusive?: boolean;
    startingTrack?: number | "random";
    shuffle?: boolean;
    useHTML5Audio?: boolean;
    useWebAudio?: boolean;
    loadLimit?: number | null;
    volume?: number;
    crossfade?: number;
    // Runtime values: None=1, Linear=2, EqualPower=3
    crossfadeShape?: number;
    playbackRate?: number;
    // Runtime values: Debug=1, Info=2, Warning=3, Error=4, None=5
    logLevel?: number;
    analyserPrecision?: number | null;
    guiId?: string;
  }

  class Gapless5 {
    constructor(options?: Gapless5Options);

    // Playback
    play(): void;
    pause(): void;
    stop(): void;
    playpause(): void;
    isPlaying(): boolean;

    // Navigation
    next(uiEvent?: unknown, forcePlay?: boolean, crossfadeEnabled?: boolean): void;
    prev(uiEvent?: unknown, forceReset?: boolean): void;
    prevtrack(): void;
    gotoTrack(
      pointOrPath: number | string,
      forcePlay?: boolean,
      allowOverride?: boolean,
      crossfadeEnabled?: boolean,
    ): void;
    queueTrack(pointOrPath: number | string): void;

    // Track management
    addTrack(url: string): void;
    insertTrack(index: number, url: string): void;
    replaceTrack(index: number, url: string): void;
    removeTrack(indexOrPath: number | string): void;
    removeAllTracks(flushPlaylist?: boolean): void;

    // State
    setPosition(ms: number): void;
    setVolume(vol: number): void;
    setPlaybackRate(rate: number): void;
    setCrossfade(ms: number): void;
    setCrossfadeShape(shape: number): void;
    shuffle(preserveCurrent?: boolean): void;
    toggleShuffle(): void;

    // Getters
    getTrack(): string;
    getTracks(): string[];
    getIndex(sourceIndex?: boolean): number;
    getPosition(): number;
    getSeekablePercent(): number;
    findTrack(url: string): number;
    isShuffled(): boolean;
    currentLength(): number;
    currentPosition(): number;
    totalTracks(): number;

    // Properties
    loop: boolean;
    singleMode: boolean;
    volume: number;
    crossfade: number;
    crossfadeShape: number;

    // Callbacks — signatures match gapless5.js runtime (NOT older TS hints)
    ontimeupdate: ((positionMs: number, trackIndex: number) => void) | null;
    onplay: ((trackPath: string, analyser: AnalyserNode | null) => void) | null;
    onplayrequest: ((trackPath: string) => void) | null;
    onpause: ((trackPath: string) => void) | null;
    onstop: ((trackPath: string) => void) | null;
    onnext: ((from: string, to: string) => void) | null;
    onprev: ((from: string, to: string) => void) | null;
    onloadstart: ((trackPath: string) => void) | null;
    onload: ((trackPath: string, fullyLoaded: boolean) => void) | null;
    onunload: ((trackPath: string) => void) | null;
    onerror: ((trackPath: string, error?: Error | string) => void) | null;
    onfinishedtrack: ((trackPath: string) => void) | null;
    onfinishedall: (() => void) | null;
    // Runtime (gapless5.js:309) passes (trackPath, analyser).
    onswitchtowebaudio: ((trackPath: string, analyser: AnalyserNode | null) => void) | null;
  }

  export { Gapless5 };
}
