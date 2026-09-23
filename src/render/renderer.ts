/**
 * Minimal Canvas 2D renderer for the subway simulation.
 *
 * Rendering is read-only: this module never mutates GameState or any domain
 * object. TrainSystem owns movement; the renderer uses Train.position directly.
 */

import type { GameState } from "../core/gameLoop";
import type { Line, Position, Station, Train } from "../core/types";

export interface RendererOptions {
  backgroundColor?: string;
  riverColor?: string;
  riverWidth?: number;
  stationRadius?: number;
}

const DEFAULTS = {
  backgroundColor: "#f7f5ef",
  riverColor: "#b9dfe8",
  riverWidth: 40,
  stationRadius: 12,
} as const;

/** Canvas renderer with a single public draw method. */
export class Renderer {
  private readonly backgroundColor: string;
  private readonly riverColor: string;
  private readonly riverWidth: number;
  private readonly stationRadius: number;

  constructor(options: RendererOptions = {}) {
    this.backgroundColor = options.backgroundColor ?? DEFAULTS.backgroundColor;
    this.riverColor = options.riverColor ?? DEFAULTS.riverColor;
    this.riverWidth = options.riverWidth ?? DEFAULTS.riverWidth;
    this.stationRadius = options.stationRadius ?? DEFAULTS.stationRadius;
  }

  draw(ctx: CanvasRenderingContext2D, gameState: GameState): void {
    const { canvas } = ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.drawRiver(ctx, gameState.river);

    const stations = new Map(gameState.stations.map((station) => [station.id, station]));
    for (const line of gameState.lines) {
      this.drawLine(ctx, line, stations);
    }

    for (const train of gameState.trains) {
      this.drawTrain(ctx, train, gameState.lines, stations);
    }

    for (const station of gameState.stations) {
      this.drawStation(ctx, station, gameState.totalTime);
    }
  }

  private drawRiver(ctx: CanvasRenderingContext2D, points: readonly Position[]): void {
    if (points.length < 2) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.strokeStyle = this.riverColor;
    ctx.lineWidth = this.riverWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }

  private drawLine(
    ctx: CanvasRenderingContext2D,
    line: Line,
    stations: ReadonlyMap<string, Station>,
  ): void {
    const points = line.stationIds
      .map((id) => stations.get(id)?.position)
      .filter((point): point is Position => point !== undefined);
    if (points.length < 2) return;

    ctx.save();
    ctx.beginPath();
    drawCatmullRomPath(ctx, points);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  }

  private drawStation(
    ctx: CanvasRenderingContext2D,
    station: Station,
    totalTime: number,
  ): void {
    const crowded = station.waitingPassengers.length >= 6;
    const pulse = crowded ? 1 + 0.12 * (0.5 + 0.5 * Math.sin(totalTime * Math.PI * 5)) : 1;
    const radius = this.stationRadius * pulse;

    ctx.save();
    ctx.translate(station.position.x, station.position.y);
    if (crowded) {
      ctx.shadowColor = "rgba(231, 76, 60, 0.65)";
      ctx.shadowBlur = 12 * pulse;
    }
    ctx.fillStyle = crowded ? "#e76f6a" : "#fffdf8";
    ctx.strokeStyle = crowded ? "#c0392b" : "#53636b";
    ctx.lineWidth = 3;
    drawStationShape(ctx, station.shape, radius);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    this.drawWaitingPassengers(ctx, station, totalTime);
  }

  private drawWaitingPassengers(
    ctx: CanvasRenderingContext2D,
    station: Station,
    totalTime: number,
  ): void {
    const count = station.waitingPassengers.length;
    if (count === 0) return;

    const orbitRadius = this.stationRadius + 10;
    ctx.save();
    ctx.fillStyle = "#65747b";
    ctx.strokeStyle = "#fffdf8";
    ctx.lineWidth = 1;

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + totalTime * 0.25;
      const x = station.position.x + Math.cos(angle) * orbitRadius;
      const y = station.position.y + Math.sin(angle) * orbitRadius;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTrain(
    ctx: CanvasRenderingContext2D,
    train: Train,
    lines: readonly Line[],
    stations: ReadonlyMap<string, Station>,
  ): void {
    const line = lines.find((candidate) => candidate.id === train.lineId);
    const angle = line ? getTrainAngle(train, line, stations) : 0;
    // A small speed-dependent scale gives acceleration/deceleration a subtle
    // visual cue without taking movement ownership away from TrainSystem.
    const speedScale = 1 + Math.min(0.12, Math.abs(train.speed) / 1000);

    ctx.save();
    ctx.translate(train.position.x, train.position.y);
    ctx.rotate(angle);
    ctx.scale(speedScale, 1);
    ctx.fillStyle = line?.color ?? "#53636b";
    ctx.strokeStyle = "rgba(38, 50, 56, 0.55)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, -10, -6, 20, 12, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Convenience function for callers that do not need renderer configuration. */
export function draw(ctx: CanvasRenderingContext2D, gameState: GameState): void {
  new Renderer().draw(ctx, gameState);
}

function drawStationShape(
  ctx: CanvasRenderingContext2D,
  shape: Station["shape"],
  radius: number,
): void {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 3;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    roundRect(ctx, -radius, -radius, radius * 2, radius * 2, 3);
  }
}

function drawCatmullRomPath(
  ctx: CanvasRenderingContext2D,
  points: readonly Position[],
): void {
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const segments = 12;

    for (let step = 1; step <= segments; step += 1) {
      const t = step / segments;
      const point = catmullRom(p0, p1, p2, p3, t);
      ctx.lineTo(point.x, point.y);
    }
  }
}

function catmullRom(
  p0: Position,
  p1: Position,
  p2: Position,
  p3: Position,
  t: number,
): Position {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function getTrainAngle(
  train: Train,
  line: Line,
  stations: ReadonlyMap<string, Station>,
): number {
  let nearest: Position | undefined;
  let next: Position | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const stationId of line.stationIds) {
    const station = stations.get(stationId);
    if (!station) continue;
    const distance = Math.hypot(train.position.x - station.position.x, train.position.y - station.position.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = station.position;
    }
  }

  if (!nearest) return 0;
  const index = line.stationIds.findIndex((id) => stations.get(id)?.position === nearest);
  next = stations.get(line.stationIds[Math.min(index + 1, line.stationIds.length - 1)])?.position;
  if (!next) return 0;
  return Math.atan2(next.y - nearest.y, next.x - nearest.x);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
