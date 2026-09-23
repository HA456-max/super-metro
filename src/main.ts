import { createMetroGraph } from "./core/graph";
import { GameLoop } from "./core/gameLoop";
import { Line, Station, Train } from "./core/types";
import { generateMap } from "./systems/mapGenerator";
import { PassengerSystem } from "./systems/passengerSystem";
import { ResourceSystem } from "./systems/resourceSystem";
import { TrainSystem } from "./systems/trainSystem";
import { Renderer } from "./render/renderer";
import { GameUI } from "./ui/ui";

const canvas = document.querySelector<HTMLCanvasElement>("#gameCanvas");
if (!canvas) throw new Error("Canvas #gameCanvas not found");

const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas 2D context is not available");

const renderer = new Renderer();
let gameLoop: GameLoop;
let ui: GameUI;

function resizeCanvas(): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function render(): void {
  if (!gameLoop) return;
  renderer.draw(context, gameLoop.state);
}

function createGame(): void {
  gameLoop?.stop();

  const width = window.innerWidth;
  const height = window.innerHeight;
  const map = generateMap(width, height, 1, { stationCount: 8 });
  const stations: Station[] = map.stations;
  const firstStationIds = stations.slice(0, Math.min(4, stations.length)).map((station) => station.id);
  const lines: Line[] = firstStationIds.length >= 2
    ? [{ id: "line-1", color: "#e76f51", stationIds: firstStationIds, trainIds: ["train-1"] }]
    : [];
  const trains: Train[] = lines.length > 0
    ? [{
        id: "train-1",
        lineId: "line-1",
        position: { ...stations[0].position },
        speed: 100,
        capacity: 6,
        passengers: [],
      }]
    : [];

  const graph = createMetroGraph(stations, lines);
  const resources = new ResourceSystem();
  const passengerSystem = new PassengerSystem(stations, graph, {
    initialSpawnInterval: 5,
  });
  const trainSystem = new TrainSystem(trains, stations, lines, graph, {
    speed: 100,
    passengerSystem,
  });

  gameLoop = new GameLoop({
    width,
    height,
    stations,
    lines,
    trains,
    river: map.river,
    graph,
    passengerSystem,
    trainSystem,
    resourceSystem: resources,
    onStateChanged: (state) => ui?.update(state),
    onGameOver: (state) => ui?.update(state),
    render: () => render(),
  });

  ui?.destroy();
  ui = new GameUI({
    pause: () => gameLoop.pause(),
    resume: () => gameLoop.resume(),
    applyUpgrade: (option) => gameLoop.applyUpgrade(option),
    restart: () => createGame(),
    setSpeed: () => {
      // 速度按钮由 UI 预留；后续可将倍速接到 GameLoop 的时间缩放。
    },
  });

  ui.update(gameLoop.state);
  resizeCanvas();
  gameLoop.start();
}

window.addEventListener("resize", resizeCanvas);
createGame();
