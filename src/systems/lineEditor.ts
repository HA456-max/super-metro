/**
 * Pointer-driven line drawing and editing.
 *
 * This module manages the editable metro lines in a pure, UI-agnostic way:
 * - start a new line by clicking a station
 * - extend an existing line by dragging to another station
 * - delete a station from a line
 * - recolor a line from a preset palette
 *
 * Rendering stays in the canvas layer; lineEditor.ts only exposes editing state.
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
  /** Return false to block line creation when the resource system is exhausted. */
  canCreateLine(): boolean;
}

export interface LineEditorOptions {
  hitRadius?: number;
  colorPalette?: readonly string[];
  resourcePolicy?: LineResourcePolicy;
  createLineId?: () => string;
  /** Lets callers decide which line to extend when several lines share the clicked station. */
  selectLine?: (station: Station, candidates: readonly Line[]) => Line | undefined;
}

export type Point2D = Position;

type EditMode = "new" | "append" | "prepend";

interface ActiveEdit {
  lineId?: string;
  stationIds: string[];
  mode: EditMode;
}

export class LineEditor {
  private readonly stations: readonly Station[];
  private readonly stationById: ReadonlyMap<string, Station>;
  private readonly lines: Line[];
  private readonly hitRadius: number;
  private readonly colorPalette: readonly string[];
  private readonly resourcePolicy?: LineResourcePolicy;
  private readonly createLineId: () => string;
  private readonly selectLine?: (station: Station, candidates: readonly Line[]) => Line | undefined;
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
    this.colorPalette = options.colorPalette ?? [...DEFAULT_LINE_COLORS];
    this.resourcePolicy = options.resourcePolicy;
    this.createLineId = options.createLineId ?? defaultLineId;
    this.selectLine = options.selectLine;
  }

  /**
   * Returns the station that is closest to the pointer and lies within the hit radius.
   * If multiple stations are within radius, the nearest one wins.
   */
  hitTest(point: Point2D): Station | undefined {
    let best: Station | undefined;
    let bestSquared = this.hitRadius * this.hitRadius;

    for (const station of this.stations) {
      const dx = station.position.x - point.x;
      const dy = station.position.y - point.y;
      const squared = dx * dx + dy * dy;

      if (squared <= bestSquared) {
        best = station;
        bestSquared = squared;
      }
    }

    return best;
  }

  /**
   * Start editing:
   * - if pointer is on an existing line endpoint, extend it
   * - otherwise create a new line
   */
  pointerDown(point: Point2D): boolean {
    if (this.activeEdit) return false;

    const station = this.hitTest(point);
    if (!station) return false;

    const candidates = this.lines.filter((line) => line.stationIds.includes(station.id));

    const selected = this.selectLine?.(station, candidates) ?? this.defaultLineForEdit(candidates, station.id);
    if (selected) {
      const index = selected.stationIds.indexOf(station.id);
      const mode: EditMode = index === 0 ? "prepend" : "append";

      this.activeEdit = {
        lineId: selected.id,
        stationIds: [station.id],
        mode,
      };
      return true;
    }

    if (this.resourcePolicy && !this.resourcePolicy.canCreateLine()) {
      return false;
    }

    this.activeEdit = {
      lineId: undefined,
      stationIds: [station.id],
      mode: "new",
    };
    return true;
  }

  /**
   * Dragging across another station adds it to the current route.
   * Duplicate station IDs are ignored.
   */
  pointerMove(point: Point2D): boolean {
    if (!this.activeEdit) return false;

    const station = this.hitTest(point);
    if (!station) return false;
    if (this.activeEdit.stationIds.includes(station.id)) return false;

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
    if (!line) return false;

    if (line.stationIds.includes(station.id)) return false;

    if (this.activeEdit.mode === "prepend") {
      line.stationIds.unshift(station.id);
    } else {
      line.stationIds.push(station.id);
    }

    this.activeEdit.stationIds = [...line.stationIds];
    return true;
  }

  /**
   * Finalizes the current line edit.
   * For a newly-created line, a single-station draft is discarded.
   */
  pointerUp(): Line | undefined {
    const current = this.activeEdit;
    this.activeEdit = undefined;

    if (!current) return undefined;

    const line = current.lineId ? this.lines.find((candidate) => candidate.id === current.lineId) : undefined;
    if (current.mode === "new" && (!line || line.stationIds.length < 2)) {
      if (line) {
        const index = this.lines.indexOf(line);
        if (index >= 0) this.lines.splice(index, 1);
      }
      return undefined;
    }

    if (line) {
      line.stationIds = dedupeStationIds(line.stationIds);
      return line;
    }

    return undefined;
  }

  /** Cancels the current in-progress edit. */
  cancel(): void {
    const current = this.activeEdit;
    if (!current) return;

    if (current.mode === "new" && current.lineId) {
      const line = this.lines.find((candidate) => candidate.id === current.lineId);
      if (line) {
        const index = this.lines.indexOf(line);
        if (index >= 0) this.lines.splice(index, 1);
      }
    }

    this.activeEdit = undefined;
  }

  /**
   * Remove a station from a line.
   * The line remains valid if at least 2 station IDs remain.
   */
  removeStationFromLine(lineId: string, stationId: string): boolean {
    const line = this.lines.find((candidate) => candidate.id === lineId);
    if (!line) return false;

    const index = line.stationIds.indexOf(stationId);
    if (index < 0) return false;

    line.stationIds.splice(index, 1);
    line.stationIds = dedupeStationIds(line.stationIds);

    if (line.stationIds.length < 2) {
      const removeIndex = this.lines.indexOf(line);
      if (removeIndex >= 0) this.lines.splice(removeIndex, 1);
      return true;
    }

    return true;
  }

  /** Recolor an existing line using the preset palette only. */
  setLineColor(lineId: string, color: string): boolean {
    if (!this.colorPalette.includes(color)) return false;

    const line = this.lines.find((candidate) => candidate.id === lineId);
    if (!line) return false;

    line.color = color;
    return true;
  }

  /** Return the current draft station order for preview rendering. */
  getDraftStationIds(): readonly string[] {
    return this.activeEdit?.stationIds ?? [];
  }

  /** Return the line currently being edited, if any. */
  getActiveLine(): Line | undefined {
    if (!this.activeEdit?.lineId) return undefined;
    return this.lines.find((line) => line.id === this.activeEdit?.lineId);
  }

  getPalette(): readonly string[] {
    return this.colorPalette;
  }

  private defaultLineForEdit(candidates: readonly Line[], stationId: string): Line | undefined {
    return candidates.find((line) => {
      const index = line.stationIds.indexOf(stationId);
      return index === 0 || index === line.stationIds.length - 1;
    });
  }

  private nextColor(): string {
    return this.colorPalette[this.lines.length % this.colorPalette.length] ?? "#000000";
  }
}

function dedupeStationIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

function defaultLineId(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert a pointer event into canvas space. */
export function getCanvasPoint(event: PointerEvent, canvas: HTMLCanvasElement): Point2D {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}
