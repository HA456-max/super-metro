/**
 * Pointer-driven line drawing and editing.
 *
 * This module owns editing state only. Rendering is intentionally left to the
 * Canvas layer; callers can use `getDraftStationIds()` to draw the in-progress
 * line.
 */

import { Line, Position, Station } from "../core/types";

export const DEFAULT_LINE_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f1c40f",
  "#9b59b6",
  "#e67e22",
] as const;

export interface LineResourcePolicy {
  /** Return false when the resource system does not allow another line. */
  canCreateLine(): boolean;
}

export interface LineEditorOptions {
  hitRadius?: number;
  colorPalette?: readonly string[];
  resourcePolicy?: LineResourcePolicy;
  createLineId?: () => string;
  /** Resolves which line to edit when several lines contain the start station. */
  selectLine?: (station: Station, candidates: readonly Line[]) => Line | undefined;
}

export interface LineEditorPoint extends Position {}

type EditMode = "new" | "prepend" | "append";

interface ActiveEdit {
  lineId?: string;
  stationIds: string[];
  mode: EditMode;
}

/**
 * Manages line creation, extension, station removal, and color changes.
 *
 * The supplied `lines` array is the source of truth and is updated in place
 * when a line is created or edited. Station objects are never modified.
 */
export class LineEditor {
  private readonly stations: readonly Station[];
  private readonly stationById: ReadonlyMap<string, Station>;
  private readonly lines: Line[];
  private readonly hitRadius: number;
  private readonly colorPalette: readonly string[];
  private readonly resourcePolicy?: LineResourcePolicy;
  private readonly createLineId: () => string;
  private readonly selectLine?: LineEditorOptions["selectLine"];
  private activeEdit?: ActiveEdit;

  constructor(
    stations: readonly Station[],
    lines: Line[],
    options: LineEditorOptions = {},
  ) {
    this.stations = stations;
    this.stationById = new Map(stations.map((station) => [station.id, station]));
    this.lines = lines;
    this.hitRadius = options.hitRadius ?? 20;
    this.colorPalette = options.colorPalette ?? DEFAULT_LINE_COLORS;
    this.resourcePolicy = options.resourcePolicy;
    this.createLineId = options.createLineId ?? defaultLineId;
    this.selectLine = options.selectLine;
  }

  /** Finds the nearest station within the configured hit radius. */
  hitTest(point: LineEditorPoint): Station | undefined {
    const radiusSquared = this.hitRadius * this.hitRadius;
    let nearest: Station | undefined;
    let nearestDistance = radiusSquared;

    for (const station of this.stations) {
      const dx = station.position.x - point.x;
      const dy = station.position.y - point.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared <= nearestDistance) {
        nearest = station;
        nearestDistance = distanceSquared;
      }
    }
    return nearest;
  }

  /** Starts a new line or starts extending an existing line at an endpoint. */
  pointerDown(point: LineEditorPoint): boolean {
    if (this.activeEdit) return false;

    const station = this.hitTest(point);
    if (!station) return false;

    const candidates = this.lines.filter((line) =>
      line.stationIds.includes(station.id),
    );
    const selected = this.selectLine?.(station, candidates) ?? this.defaultLine(candidates, station.id);

    if (selected) {
      const index = selected.stationIds.indexOf(station.id);
      this.activeEdit = {
        lineId: selected.id,
        stationIds: [station.id],
        mode: index === 0 ? "prepend" : "append",
      };
      return true;
    }

    if (this.resourcePolicy && !this.resourcePolicy.canCreateLine()) return false;
    this.activeEdit = { stationIds: [station.id], mode: "new" };
    return true;
  }

  /** Adds a station when the pointer passes over it. Duplicate stations are ignored. */
  pointerMove(point: LineEditorPoint): boolean {
    if (!this.activeEdit) return false;

    const station = this.hitTest(point);
    if (!station || this.activeEdit.stationIds.includes(station.id)) return false;

    if (this.activeEdit.mode === "new") {
      const line: Line = {
        id: this.createLineId(),
        color: this.nextColor(),
        stationIds: [this.activeEdit.stationIds[0], station.id],
        trainIds: [],
      };
      this.lines.push(line);
      this.activeEdit = {
        lineId: line.id,
        stationIds: [...line.stationIds],
        mode: "append",
      };
      return true;
    }

    const line = this.getActiveLine();
    if (!line || line.stationIds.includes(station.id)) return false;

    if (this.activeEdit.mode === "prepend") line.stationIds.unshift(station.id);
    else line.stationIds.push(station.id);
    this.activeEdit.stationIds = [...line.stationIds];
    return true;
  }

  /** Finishes the current edit. One-station new lines are not persisted. */
  pointerUp(): Line | undefined {
    const line = this.getActiveLine();
    const edit = this.activeEdit;
    this.activeEdit = undefined;

    if (!line || !edit) return undefined;
    if (edit.mode === "new" && line.stationIds.length < 2) {
      const index = this.lines.indexOf(line);
      if (index >= 0) this.lines.splice(index, 1);
      return undefined;
    }
    return line;
  }

  cancel(): void {
    const line = this.getActiveLine();
    if (line && this.activeEdit?.mode === "new") {
      const index = this.lines.indexOf(line);
      if (index >= 0) this.lines.splice(index, 1);
    }
    this.activeEdit = undefined;
  }

  /** Returns the currently edited route, suitable for preview rendering. */
  getDraftStationIds(): readonly string[] {
    return this.activeEdit?.stationIds ?? [];
  }

  removeStationFromLine(lineId: string, stationId: string): boolean {
    const line = this.lines.find((candidate) => candidate.id === lineId);
    if (!line) return false;
    const index = line.stationIds.indexOf(stationId);
    if (index < 0) return false;
    line.stationIds.splice(index, 1);
    return true;
  }

  setLineColor(lineId: string, color: string): boolean {
    if (!this.colorPalette.includes(color)) return false;
    const line = this.lines.find((candidate) => candidate.id === lineId);
    if (!line) return false;
    line.color = color;
    return true;
  }

  getPalette(): readonly string[] {
    return this.colorPalette;
  }

  private defaultLine(candidates: readonly Line[], stationId: string): Line | undefined {
    return candidates.find((line) => {
      const index = line.stationIds.indexOf(stationId);
      return index === 0 || index === line.stationIds.length - 1;
    });
  }

  private getActiveLine(): Line | undefined {
    if (!this.activeEdit?.lineId) return undefined;
    return this.lines.find((line) => line.id === this.activeEdit?.lineId);
  }

  private nextColor(): string {
    return this.colorPalette[this.lines.length % this.colorPalette.length] ?? "#000000";
  }
}

function defaultLineId(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getCanvasPoint(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): LineEditorPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}
