export type MapAction = "zoom-in" | "zoom-out" | "fit" | "reset" | "export";
export type MapTool = "navigate" | "pan" | "region";
export interface MapCommand {
  action: MapAction;
  sequence: number;
}

/** Capture exactly the renderer's current camera, with an opaque map background. */
export function exportMapCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  const ctx = output.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0c1420";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvas, 0, 0);
  output.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mapa-mesh.png";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
