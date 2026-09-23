/**
 * Procedural map generation.
 *
 * The river is represented by sampled points on a cubic Bezier curve. The
 * latest generated river is retained so `isOverRiver(point)` can be used by
 * interaction code without passing map state through every call.
 */

import { Line, Position, Station, StationShape } from "../core/types";

export interface RiverPathPoint extends Position {}

export interface GeneratedMap {
  stations: Station[];
  river: RiverPathPoint[];
}

export interface MapGeneratorOptions {
  minimumStationDistance?: number;
  riverWidth?: number;
  stationCount?: number;
  random?: () => number;
}

const DEFAULT_MINIMUM_STATION_DISTANCE = 80;
const DEFAULT_RIVER_WIDTH = 36;
const DEFAULT_STATION_COUNT = 18;
const RIVER_SAMPLES = 64;

let currentRiver: RiverPathPoint[] = [];
let currentRiverWidth = DEFAULT_RIVER_WIDTH;

/**
 * Generates a river crossing the map using a cubic Bezier curve.
 * The returned points are ordered from one map edge to the other.
 */
export function generateRiver(
  width: number,
  height: number,
  riverWidth = DEFAULT_RIVER_WIDTH,
): RiverPathPoint[] {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  // A mostly vertical river leaves playable land on both sides while the
  // control points create a natural-looking bend.
  const p0: Position = { x: safeWidth * 0.38, y: -safeHeight * 0.05 };
  const p1: Position = { x: safeWidth * 0.78, y: safeHeight * 0.28 };
  const p2: Position = { x: safeWidth * 0.12, y: safeHeight * 0.68 };
  const p3: Position = { x: safeWidth * 0.62, y: safeHeight * 1.05 };

  const points: RiverPathPoint[] = [];
  for (let index = 0; index <= RIVER_SAMPLES; index += 1) {
    const t = index / RIVER_SAMPLES;
    points.push(cubicBezier(p0, p1, p2, p3, t));
  }

  currentRiver = points;
  currentRiverWidth = Math.max(0, riverWidth);
  return points.map(copyPoint);
}

/** Returns true when a point lies within the current river corridor. */
export function isOverRiver(point: Position): boolean {
  if (currentRiver.length < 2) return false;

  const halfWidth = currentRiverWidth / 2;
  for (let index = 1; index < currentRiver.length; index += 1) {
    if (distanceToSegment(point, currentRiver[index - 1], currentRiver[index]) <= halfWidth) {
      return true;
    }
  }
  return false;
}

/**
 * Generates stations with Bridson-style Poisson-disc sampling.
 * `week` controls shape unlocks: circles in week 1, triangles from week 2,
 * and squares from week 3.
 */
export function generateMap(
  width: number,
  height: number,
  week: number,
  options: MapGeneratorOptions = {},
): GeneratedMap {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const minimumDistance = Math.max(
    1,
    options.minimumStationDistance ?? DEFAULT_MINIMUM_STATION_DISTANCE,
  );
  const river = generateRiver(safeWidth, safeHeight, options.riverWidth ?? DEFAULT_RIVER_WIDTH);
  const random = options.random ?? Math.random;
  const desiredCount = Math.max(0, Math.floor(options.stationCount ?? DEFAULT_STATION_COUNT));
  const positions = poissonSample(
    safeWidth,
    safeHeight,
    minimumDistance,
    desiredCount,
    random,
    isOverRiver,
  );

  const stations = positions.map((position, index) => ({
    id: `station-${index + 1}`,
    position,
    shape: chooseShape(week, random),
    waitingPassengers: [],
  } satisfies Station));

  return { stations, river };
}

/** Returns whether a line contains a segment crossing the current river. */
export function lineCrossesRiver(
  line: Pick<Line, "stationIds">,
  stations: readonly Station[],
): boolean {
  const stationMap = new Map(stations.map((station) => [station.id, station]));
  for (let index = 1; index < line.stationIds.length; index += 1) {
    const from = stationMap.get(line.stationIds[index - 1]);
    const to = stationMap.get(line.stationIds[index]);
    if (from && to && segmentCrossesRiver(from.position, to.position)) return true;
  }
  return false;
}

/** Alias suitable for a resource system's tunnel check. */
export const requiresTunnel = lineCrossesRiver;

function poissonSample(
  width: number,
  height: number,
  minimumDistance: number,
  desiredCount: number,
  random: () => number,
  blocked: (point: Position) => boolean,
): Position[] {
  if (desiredCount === 0) return [];

  const cellSize = minimumDistance / Math.SQRT2;
  const grid = new Map<string, Position>();
  const active: Position[] = [];
  const result: Position[] = [];
  const maxAttempts = 30;

  const add = (point: Position): void => {
    result.push(point);
    active.push(point);
    grid.set(gridKey(point, cellSize), point);
  };

  // Try several seeds because the river may block the first candidates.
  for (let attempt = 0; attempt < 100 && result.length === 0; attempt += 1) {
    const seed = randomPoint(width, height, random);
    if (!blocked(seed)) add(seed);
  }
  if (result.length === 0) return [];

  while (active.length > 0 && result.length < desiredCount) {
    const activeIndex = Math.min(active.length - 1, Math.floor(random() * active.length));
    const source = active[activeIndex];
    let accepted = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radius = minimumDistance * (1 + random());
      const candidate = {
        x: source.x + Math.cos(angle) * radius,
        y: source.y + Math.sin(angle) * radius,
      };
      if (
        candidate.x < 0 || candidate.x > width ||
        candidate.y < 0 || candidate.y > height ||
        blocked(candidate) ||
        hasNearbyPoint(candidate, grid, cellSize, minimumDistance)
      ) continue;

      add(candidate);
      accepted = true;
      break;
    }

    if (!accepted) active.splice(activeIndex, 1);
  }

  return result;
}

function chooseShape(week: number, random: () => number): StationShape {
  if (week < 2) return "circle";
  if (week < 3) return random() < 0.5 ? "circle" : "triangle";
  const shapes: StationShape[] = ["circle", "triangle", "square"];
  return shapes[Math.min(shapes.length - 1, Math.floor(random() * shapes.length))];
}

function cubicBezier(a: Position, b: Position, c: Position, d: Position, t: number): Position {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * a.x + 3 * inverse ** 2 * t * b.x + 3 * inverse * t ** 2 * c.x + t ** 3 * d.x,
    y: inverse ** 3 * a.y + 3 * inverse ** 2 * t * b.y + 3 * inverse * t ** 2 * c.y + t ** 3 * d.y,
  };
}

function segmentCrossesRiver(a: Position, b: Position): boolean {
  const steps = 16;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    if (isOverRiver({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return true;
  }
  return false;
}

function distanceToSegment(point: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function hasNearbyPoint(
  candidate: Position,
  grid: ReadonlyMap<string, Position>,
  cellSize: number,
  minimumDistance: number,
): boolean {
  const cellX = Math.floor(candidate.x / cellSize);
  const cellY = Math.floor(candidate.y / cellSize);
  for (let x = cellX - 2; x <= cellX + 2; x += 1) {
    for (let y = cellY - 2; y <= cellY + 2; y += 1) {
      const point = grid.get(`${x}:${y}`);
      if (point && Math.hypot(candidate.x - point.x, candidate.y - point.y) < minimumDistance) return true;
    }
  }
  return false;
}

function gridKey(point: Position, cellSize: number): string {
  return `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
}

function randomPoint(width: number, height: number, random: () => number): Position {
  return { x: random() * width, y: random() * height };
}

function copyPoint(point: Position): RiverPathPoint {
  return { x: point.x, y: point.y };
}
