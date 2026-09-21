/**
 * Passenger spawning and route-aware boarding rules.
 *
 * This system owns waiting passengers and simulation time. It does not move
 * trains; TrainSystem calls `canBoard` when a train arrives at a station.
 */

import { findRouteWithTransfer, MetroGraph } from "../core/graph";
import { Line, Passenger, Station, StationShape, Train } from "../core/types";

export interface PassengerSystemOptions {
  /** Initial spawn interval in seconds. */
  initialSpawnInterval?: number;
  /** Minimum interval after speed-up is applied. */
  minimumSpawnInterval?: number;
  /** Interval reduction per second of game time. */
  intervalAcceleration?: number;
  random?: () => number;
  createPassengerId?: () => string;
}

export const DEFAULT_INITIAL_SPAWN_INTERVAL = 8;
export const DEFAULT_MINIMUM_SPAWN_INTERVAL = 1;
export const DEFAULT_INTERVAL_ACCELERATION = 0.002;

export class PassengerSystem {
  private readonly stations: Station[];
  private readonly stationMap: ReadonlyMap<string, Station>;
  private readonly graph: MetroGraph;
  private readonly initialSpawnInterval: number;
  private readonly minimumSpawnInterval: number;
  private readonly intervalAcceleration: number;
  private readonly random: () => number;
  private readonly createPassengerId: () => string;
  private elapsedSinceSpawn = 0;
  private gameTime = 0;

  constructor(
    stations: Station[],
    graph: MetroGraph,
    options: PassengerSystemOptions = {},
  ) {
    this.stations = stations;
    this.stationMap = new Map(stations.map((station) => [station.id, station]));
    this.graph = graph;
    this.initialSpawnInterval = options.initialSpawnInterval ?? DEFAULT_INITIAL_SPAWN_INTERVAL;
    this.minimumSpawnInterval = options.minimumSpawnInterval ?? DEFAULT_MINIMUM_SPAWN_INTERVAL;
    this.intervalAcceleration = options.intervalAcceleration ?? DEFAULT_INTERVAL_ACCELERATION;
    this.random = options.random ?? Math.random;
    this.createPassengerId = options.createPassengerId ?? defaultPassengerId;
  }

  /** Advances game time and spawns one or more passengers when due. */
  update(deltaTime: number): Passenger[] {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return [];

    this.gameTime += deltaTime;
    this.elapsedSinceSpawn += deltaTime;
    const spawned: Passenger[] = [];

    let interval = this.getSpawnInterval();
    while (this.elapsedSinceSpawn >= interval) {
      this.elapsedSinceSpawn -= interval;
      const passenger = this.spawnPassenger();
      if (passenger) spawned.push(passenger);
      interval = this.getSpawnInterval();
    }

    return spawned;
  }

  /** Generates a passenger at a random station with a different target station. */
  spawnPassenger(): Passenger | undefined {
    if (this.stations.length < 2) return undefined;

    const originIndex = randomIndex(this.random, this.stations.length);
    let targetIndex = randomIndex(this.random, this.stations.length - 1);
    if (targetIndex >= originIndex) targetIndex += 1;

    const origin = this.stations[originIndex];
    const target = this.stations[targetIndex];
    const passenger: Passenger = {
      id: this.createPassengerId(),
      destinationShape: target.shape,
      currentStationId: origin.id,
      targetStationId: target.id,
    };

    origin.waitingPassengers.push(passenger);
    return passenger;
  }

  /**
   * Returns true only when this train's line is the first line in the minimum-
   * transfer BFS route from the passenger's current station to its target.
   */
  canBoard(passenger: Passenger, train: Train, line: Line): boolean {
    if (train.lineId !== line.id) return false;
    if (!this.stationMap.has(passenger.currentStationId)) return false;
    if (!this.stationMap.has(passenger.targetStationId)) return false;
    if (passenger.currentStationId === passenger.targetStationId) return false;

    const route = findRouteWithTransfer(
      this.graph,
      passenger.currentStationId,
      passenger.targetStationId,
    );

    return route !== undefined && route.length > 0 && route[0].id === line.id;
  }

  getSpawnInterval(): number {
    return Math.max(
      this.minimumSpawnInterval,
      this.initialSpawnInterval - this.gameTime * this.intervalAcceleration,
    );
  }
}

function randomIndex(random: () => number, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function defaultPassengerId(): string {
  return `passenger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
