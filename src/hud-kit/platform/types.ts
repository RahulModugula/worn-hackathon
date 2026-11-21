/**
 * Platform adapter contract shared by the desktop-browser host and the MicroLumin M6 host.
 * Generic by design: no app strings, no imports from app code.
 */

/** A raw camera or canvas frame. `data` is row-major RGBA, length = width * height * 4. */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Result of starting a device. Starting never throws; failure is reported here. */
export interface AvailabilityResult {
  available: boolean;
  /** Short, log-safe reason when `available` is false (for example `NotAllowedError`). */
  reason?: string;
}

export interface CameraAdapter {
  start(): Promise<AvailabilityResult>;
  stop(): void;
  /** Optional power saving: stop pumping frames and switch the sensor off, without releasing the permission. */
  pause?(): void;
  /** Undo pause(). Frames resume within one frame interval. */
  resume?(): void;
  /** Subscribes to frames. Returns an unsubscribe function. */
  onFrame(cb: (frame: RgbaFrame) => void): () => void;
}

export interface Transcript {
  text: string;
  final: boolean;
}

export interface MicAdapter {
  start(): Promise<AvailabilityResult>;
  stop(): void;
  /** Subscribes to host-provided transcripts (MicroLumin). Browser hosts never emit. */
  onTranscript(cb: (transcript: Transcript) => void): () => void;
}

export interface InputAdapter {
  onTap(cb: () => void): () => void;
  onLongPress(cb: () => void): () => void;
}

export interface DisplayAdapter {
  pushCanvasBitmap?(bitmap: ImageBitmap | RgbaFrame): void;
}

export interface PlatformAdapter {
  readonly name: 'browser' | 'microlumin';
  camera: CameraAdapter;
  mic: MicAdapter;
  input: InputAdapter;
  display?: DisplayAdapter;
}
