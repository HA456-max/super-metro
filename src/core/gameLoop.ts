/**
 * Main simulation loop and game state machine.
 *
 * Time values are expressed in seconds. The loop itself is responsible for
 * orchestration only; movement, spawning, routing, and rendering remain in
 * their respective systems.
 */

import { MetroGraph } from "./graph";
import { Line, Station, Train } from "./types";
import { PassengerSystem } from "../systems/passengerSystem";
import {
  ResourceSystem,
  ResourceStock,
  UpgradeOption,
} from "../systems/resourceSystem";
import { TrainSystem } from "../systems/trainSystem";
import {
  generateMap,
  GeneratedMap,
  RiverPathPoint,
} from "../systems/mapGenerator";

export type GameMode = "playing" | "paused" | "upgrade" | "gameover";

export interface GameState {
  mode: GameMode;
  /** Current week, starting at 1. */
  week: number;
  /** Elapsed seconds in the current week. */
  weekTime: number;
  /** Total simulation time in seconds. */
  totalTime: number;
  passengerRateMultiplier: number;
  upgradeOptions: UpgradeOption[];
  stations: Station[];
  lines: Line[];
  trains: Train[];
  river: RiverPathPoint[];
  resources: ResourceStock;
  gameOverReason?: string;
}

export interface GameLoopOptions {
  width: number;
  height: number;
  stations: Station[];
  lines: Line[];
  trains: Train[];
  river?: RiverPathPoint[];
  graph: MetroGraph;
  passengerSystem: PassengerSystem;
  trainSystem: TrainSystem;
  resourceSystem: ResourceSystem;
  /** Called after an upgrade is selected. */
  onUpgrade?: (option: UpgradeOption, state: GameState) => void;
  /**
   * Called when a new station is due. The callback should rebuild graph-based
   * systems after adding the station. If omitted, a generated station is added
   * to state only and callers can synchronize their systems in the callback.
   */
  onStationAdded?: (station: Station, state: GameState) => void;
  onStateChanged?: (state: Readonly<GameState>) => void;
  onGameOver?: (state: Readonly<GameState>) => void;
  render?: (state: Readonly<GameState>, alpha: number) => void;
  /** Optional injection for deterministic tests. */
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

const WEEK_LENGTH_SECONDS = 30;
const FAILURE_WAITING_COUNT = 6;
const FAILURE_GRACE_SECONDS = 10;

export class GameLoop {
  readonly state: GameState;

  private readonly width: number;
  private readonly height: number;
  private readonly passengerSystem: PassengerSystem;
  private readonly trainSystem: TrainSystem;
  private readonly resourceSystem: ResourceSystem;
  private readonly onUpgrade?: GameLoopOptions["onUpgrade"];
  private readonly onStationAdded?: GameLoopOptions["onStationAdded"];
  private readonly onStateChanged?: GameLoopOptions["onStateChanged"];
  private readonly onGameOver?: GameLoopOptions["onGameOver"];
  private readonly render?: GameLoopOptions["render"];
  private readonly now: () => number;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly overloadedFor = new Map<string, number>();
  private frameHandle?: number;
  private lastTimestamp?: number;

  constructor(options: GameLoopOptions) {
    this.width = options.width;
    this.height = options.height;
    this.passengerSystem = options.passengerSystem;
    this.trainSystem = options.trainSystem;
    this.resourceSystem = options.resourceSystem;
    this.onUpgrade = options.onUpgrade;
    this.onStationAdded = options.onStationAdded;
    this.onStateChanged = options.onStateChanged;
    this.onGameOver = options.onGameOver;
    this.render = options.render;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));

    const initialMap: GeneratedMap = {
      stations: options.stations,
      river: options.river ?? [],
    };
    this.state = {
      mode: "playing",
      week: 1,
      weekTime: 0,
      totalTime: 0,
      passengerRateMultiplier: 1,
      upgradeOptions: [],
      stations: initialMap.stations,
      lines: options.lines,
      trains: options.trains,
      river: initialMap.river,
      resources: this.resourceSystem.getResources(),
    };
  }

  start(): void {
    if (this.frameHandle !== undefined) return;
    this.lastTimestamp = undefined;
    this.frameHandle = this.requestFrame(this.onFrame);
  }

  stop(): void {
    if (this.frameHandle !== undefined) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = undefined;
    }
    this.lastTimestamp = undefined;
  }

  pause(): void {
    if (this.state.mode === "playing") this.setMode("paused");
  }

  resume(): void {
    if (this.state.mode === "paused") this.setMode("playing");
  }

  /** Selects the displayed weekly upgrade and resumes simulation. */
  applyUpgrade(option: UpgradeOption): boolean {
    if (this.state.mode !== "upgrade") return false;
    if (!this.state.upgradeOptions.some((candidate) => candidate.id === option.id)) return false;
    if (!this.resourceSystem.applyUpgrade(option)) return false;

    this.state.upgradeOptions = [];
    this.state.resources = this.resourceSystem.getResources();
    this.onUpgrade?.(option, this.state);
    this.setMode("playing");
    this.emitState();
    return true;
  }

  /** Advances the simulation by deltaTime seconds. */
  update(deltaTime: number): void {
    if (this.state.mode !== "playing") return;
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;

    const remaining = Math.min(deltaTime, 1);
    this.state.totalTime += remaining;
    this.state.weekTime += remaining;

    // PassengerSystem owns spawn timing. Scaling its input increases the rate
    // by 10% for every completed week without changing train movement speed.
    this.passengerSystem.update(remaining * this.state.passengerRateMultiplier);
    this.trainSystem.update(remaining);
    this.updateFailureTimers(remaining);

    if (this.state.mode === "gameover") return;
    if (this.state.weekTime >= WEEK_LENGTH_SECONDS) {
      this.finishWeek();
    }
    this.state.resources = this.resourceSystem.getResources();
    this.emitState();
  }

  private readonly onFrame: FrameRequestCallback = (timestamp) => {
    this.frameHandle = undefined;
    if (this.lastTimestamp === undefined) this.lastTimestamp = timestamp;
    const deltaTime = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    this.update(deltaTime);
    this.render?.(this.state, deltaTime);

    if (this.state.mode !== "gameover") {
      this.frameHandle = this.requestFrame(this.onFrame);
    }
  };

  private finishWeek(): void {
    this.state.week += 1;
    this.state.weekTime -= WEEK_LENGTH_SECONDS;
    this.state.passengerRateMultiplier = Math.pow(1.1, this.state.week - 1);

    // Frequency increases by one station every few weeks, then reaches one per week.
    const stationInterval = Math.max(1, 4 - Math.floor((this.state.week - 1) / 3));
    if (this.state.week % stationInterval === 0) {
      const generated = generateMap(this.width, this.height, this.state.week, {
        stationCount: 1,
      });
      const station = generated.stations[0];
      if (station) {
        // Keep the existing river as the active map river. generateMap updates
        // the module's river query state, while the path remains unchanged here.
        this.state.stations.push(station);
        this.onStationAdded?.(station, this.state);
      }
    }

    this.state.upgradeOptions = this.resourceSystem.getUpgradeOptions();
    this.setMode("upgrade");
  }

  private updateFailureTimers(deltaTime: number): void {
    for (const station of this.state.stations) {
      if (station.waitingPassengers.length >= FAILURE_WAITING_COUNT) {
        const elapsed = (this.overloadedFor.get(station.id) ?? 0) + deltaTime;
        this.overloadedFor.set(station.id, elapsed);
        if (elapsed >= FAILURE_GRACE_SECONDS) {
          this.state.gameOverReason = `站点 ${station.id} 等待乘客超过上限`;
          this.setMode("gameover");
          this.onGameOver?.(this.state);
          return;
        }
      } else {
        this.overloadedFor.delete(station.id);
      }
    }
  }

  private setMode(mode: GameMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.emitState();
  }

  private emitState(): void {
    this.onStateChanged?.(this.state);
  }
}

export { WEEK_LENGTH_SECONDS };
