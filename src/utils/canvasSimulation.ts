// Canvas helper to draw a realistic simulated lecture slide & blackboard when real camera feed is not accessible
export function drawSimulatedLectureFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  _mode: string,
  _timeSec: number
) {
  // Pure black screen when camera feed is unavailable
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
}
