/**
 * Train movement and station service system.
 *
 * `update` expects deltaTime in seconds. Movement state that is not part of the
 * serializable Train model (segment index, direction, and dwell time) is kept
 * internally by this system.
 */

import { findRouteWithTransfer, MetroGraph } from "../core/graph";
import { Line, Passenger, Position, Station, Train } from "../core/types";
import { PassengerSystem } from "./passengerSystem";

export const DEFAULT_TRAIN_CAPACITY = 6;
export const DEFAULT_STATION_DWELL_SECONDS = 0.5;

export interface TrainSystemOptions {
  speed?: number;
  dwellSeconds?: number;
  defaultCapacity?: number;
  passengerSystem?: PassengerSystem;
}

interface TrainState {
  segmentIndex: number;
  direction: 1 | -1;
  dwellRemaining: number;
  initialized: boolean;
}

const passengerLineIds = new Map<string, string>();

export function getPassengerLineId(passengerId: string): string | undefined {
  return passengerLineIds.get(passengerId);
}

export class TrainSystem {
  private readonly trains: Train[];
  private readonly stations: ReadonlyMap<string, Station>;
  private readonly lines: ReadonlyMap<string, Line>;
  private readonly graph: MetroGraph;
  private readonly speed: number;
  private readonly dwellSeconds: number;
  private readonly defaultCapacity: number;
  private readonly passengerSystem?: PassengerSystem;
  private readonly states = new Map<string, TrainState>();

  constructor(
    trains: Train[],
    stations: readonly Station[],
    lines: readonly Line[],
    graph: MetroGraph,
    options: TrainSystemOptions = {},
  ) {
    this.trains = trains;
    this.stations = new Map(stations.map((station) => [station.id, station]));
    this.lines = new Map(lines.map((line) => [line.id, line]));
    this.graph = graph;
    this.speed = options.speed ?? 100;
    this.dwellSeconds = options.dwellSeconds ?? DEFAULT_STATION_DWELL_SECONDS;
    this.defaultCapacity = options.defaultCapacity ?? DEFAULT_TRAIN_CAPACITY;
    this.passengerSystem = options.passengerSystem;
  }

  update(deltaTime: number): void {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    for (const train of this.trains) this.updateTrain(train, deltaTime);
  }

  private updateTrain(train: Train, deltaTime: number): void {
    const line = this.lines.get(train.lineId);
    if (!line || line.stationIds.length === 0) return;

    const route = line.stationIds
      .map((id) => this.stations.get(id))
      .filter((station): station is Station => station !== undefined);
    if (route.length === 0) return;

    const state = this.states.get(train.id) ?? this.createState(train, route);
    this.states.set(train.id, state);

    if (route.length === 1) {
      train.position = copyPosition(route[0].position);
      return;
    }

    if (state.dwellRemaining > 0) {
      const elapsed = Math.min(state.dwellRemaining, deltaTime);
      state.dwellRemaining -= elapsed;
      deltaTime -= elapsed;
      if (state.dwellRemaining > 0 || deltaTime <= 0) return;
    }

    let remainingDistance = this.speed * deltaTime;
    while (remainingDistance > 0) {
      const nextIndex = state.segmentIndex + state.direction;
      const nextStation = route[nextIndex];
      if (!nextStation) {
        state.direction = state.direction === 1 ? -1 : 1;
        continue;
      }

      const currentStation = route[state.segmentIndex];
      const segmentLength = distance(currentStation.position, nextStation.position);
      if (segmentLength === 0) {
        train.position = copyPosition(nextStation.position);
        state.segmentIndex = nextIndex;
        this.arriveAtStation(train, nextStation, state, line);
        continue;
      }

      const travelled = distance(currentStation.position, train.position);
      const remainingOnSegment = Math.max(0, segmentLength - travelled);
      if (remainingDistance < remainingOnSegment) {
        const ratio = (travelled + remainingDistance) / segmentLength;
        train.position = interpolate(currentStation.position, nextStation.position, ratio);
        return;
      }

      remainingDistance -= remainingOnSegment;
      train.position = copyPosition(nextStation.position);
      state.segmentIndex = nextIndex;
      this.arriveAtStation(train, nextStation, state, line);

      if (state.dwellRemaining > 0) {
        const consumedDwell = Math.min(
          state.dwellRemaining,
          remainingDistance / Math.max(this.speed, 1),
        );
        state.dwellRemaining -= consumedDwell;
        remainingDistance -= consumedDwell * this.speed;
        if (state.dwellRemaining > 0) return;
      }
    }
  }

  private createState(train: Train, route: readonly Station[]): TrainState {
    const index = nearestStationIndex(train.position, route);
    return {
      segmentIndex: index,
      direction: index >= route.length - 1 ? -1 : 1,
      dwellRemaining: 0,
      initialized: true,
    };
  }

  private arriveAtStation(
    train: Train,
    station: Station,
    state: TrainState,
    line: Line,
  ): void {
    this.serviceStation(train, station, line);
    state.dwellRemaining = this.dwellSeconds;
  }

  private serviceStation(train: Train, station: Station, line: Line): void {
    const remainingPassengers: Passenger[] = [];
    for (const passenger of train.passengers) {
      if (passenger.targetStationId === station.id) {
        passenger.currentStationId = station.id;
        passengerLineIds.delete(passenger.id);
      } else {
        remainingPassengers.push(passenger);
      }
    }
    train.passengers.splice(0, train.passengers.length, ...remainingPassengers);

    const capacity = train.capacity > 0 ? train.capacity : this.defaultCapacity;
    const remainingWaiting: Passenger[] = [];
    for (const passenger of station.waitingPassengers) {
      if (train.passengers.length >= capacity) {
        remainingWaiting.push(passenger);
        continue;
      }

      const canBoard = this.passengerSystem
        ? this.passengerSystem.canBoard(passenger, train, line)
        : this.canBoardWithGraph(passenger, train, line);
      if (!canBoard) {
        remainingWaiting.push(passenger);
        continue;
      }

      passengerLineIds.set(passenger.id, line.id);
      train.passengers.push(passenger);
    }

    station.waitingPassengers.splice(0, station.waitingPassengers.length, ...remainingWaiting);
  }

  /** Backward-compatible fallback when no PassengerSystem was injected. */
  private canBoardWithGraph(passenger: Passenger, train: Train, line: Line): boolean {
    if (train.lineId !== line.id) return false;
    const route = findRouteWithTransfer(this.graph, passenger.currentStationId, passenger.targetStationId);
    return route !== undefined && route.length > 0 && route[0].id === line.id;
  }
}

function distance(a: Position, b: Position): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function interpolate(a: Position, b: Position, ratio: number): Position {
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

function copyPosition(position: Position): Position {
  return { x: position.x, y: position.y };
}

function nearestStationIndex(position: Position, stations: readonly Station[]): number {
  let result = 0;
  let best = Number.POSITIVE_INFINITY;
  stations.forEach((station, index) => {
    const current = distance(position, station.position);
    if (current < best) {
      best = current;
      result = index;
    }
  });
  return result;
}
