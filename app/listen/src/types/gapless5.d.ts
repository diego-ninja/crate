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
    crossfadeShape?: "None" | "Linear" | "EqualPower";
    playbackRate?: number;
    logLevel?: "Debug" | "Info";
    guiId?: string;
  }

  class Gapless5 {
    constructor(options?: Gapless5Options);

    // Playback
    play(): void;
    pause(): void;
    stop(): void;
    playpause(): void;

    // Navigation
    next(): void;
    prev(): void;
    prevtrack(): void;
    gotoTrack(index: number | string): void;

    // Track management
    addTrack(url: string): void;
    insertTrack(index: number, url: string): void;
    replaceTrack(index: number, url: string): void;
    removeTrack(index: number | string): void;
    removeAllTracks(): void;

    // State
    setPosition(ms: number): void;
    setVolume(vol: number): void;
    setPlaybackRate(rate: number): void;
    setCrossfade(ms: number): void;
    setCrossfadeShape(shape: "None" | "Linear" | "EqualPower"): void;
    shuffle(preserveCurrent?: boolean): void;
    toggleShuffle(): void;

    // Getters
    getTrack(): string;
    getTracks(): string[];
    getIndex(): number;
    getPosition(): number;
    getSeekablePercent(): number;
    findTrack(url: string): number;
    isShuffled(): boolean;

    // Properties
    loop: boolean;
    singleMode: boolean;

    // Callbacks
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
    onerror: ((trackPath: string, error: unknown) => void) | null;
    onfinishedtrack: ((trackPath: string) => void) | null;
    onfinishedall: (() => void) | null;
    onswitchtowebaudio: (() => AnalyserNode | null) | null;
  }

  export { Gapless5 };
}
