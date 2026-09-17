export interface CanvasProps {
  readonly width?: number;
  readonly height?: number;
}

export interface CanvasEmits {
  (e: 'ready', canvas: HTMLCanvasElement): void;
}
