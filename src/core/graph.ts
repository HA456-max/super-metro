/**
 * Pure graph helpers for station and line routing.
 *
 * Every consecutive pair in a line's stationIds is connected in both
 * directions. A line therefore provides a direct route between any two of
 * its stations, regardless of their order in the list.
 */

import { Line, Station } from "./types";

export type StationId = string;

/** Adjacency list: station -> neighbouring station -> lines serving the edge. */
export type AdjacencyTable = ReadonlyMap<
  StationId,
  ReadonlyMap<StationId, readonly string[]>
>;

export interface MetroGraph {
  readonly stations: ReadonlyMap<StationId, Station>;
  readonly lines: ReadonlyMap<string, Line>;
  readonly adjacency: AdjacencyTable;
}

function addEdge(
  adjacency: Map<StationId, Map<StationId, Set<string>>>,
  fromId: string,
  toId: string,
  lineId: string,
): void {
  if (!adjacency.has(fromId)) adjacency.set(fromId, new Map());
  if (!adjacency.has(toId)) adjacency.set(toId, new Map());

  const fromNeighbours = adjacency.get(fromId)!;
  const lineIds = fromNeighbours.get(toId) ?? new Set<string>();
  lineIds.add(lineId);
  fromNeighbours.set(toId, lineIds);
}

/** Builds an adjacency-list graph without modifying the supplied models. */
export function createMetroGraph(
  stations: readonly Station[],
  lines: readonly Line[],
): MetroGraph {
  const stationMap = new Map(stations.map((station) => [station.id, station]));
  const lineMap = new Map(lines.map((line) => [line.id, line]));
  const mutable = new Map<StationId, Map<StationId, Set<string>>>();

  for (const station of stations) mutable.set(station.id, new Map());

  for (const line of lines) {
    for (let index = 0; index < line.stationIds.length - 1; index += 1) {
      const fromId = line.stationIds[index];
      const toId = line.stationIds[index + 1];
      // Ignore dangling references in the graph rather than creating phantom stations.
      if (!stationMap.has(fromId) || !stationMap.has(toId)) continue;
      addEdge(mutable, fromId, toId, line.id);
      addEdge(mutable, toId, fromId, line.id);
    }
  }

  const adjacency = new Map<StationId, ReadonlyMap<StationId, readonly string[]>>();
  for (const [stationId, neighbours] of mutable) {
    const immutableNeighbours = new Map<StationId, readonly string[]>();
    for (const [neighbourId, lineIds] of neighbours) {
      immutableNeighbours.set(neighbourId, [...lineIds]);
    }
    adjacency.set(stationId, immutableNeighbours);
  }

  return { stations: stationMap, lines: lineMap, adjacency };
}

/** Returns all lines serving a station, in input order. */
export function getLinesAtStation(
  graph: MetroGraph,
  stationId: StationId,
): Line[] {
  const lineIds = new Set<string>();
  for (const lineIdsOnEdge of graph.adjacency.get(stationId)?.values() ?? []) {
    for (const lineId of lineIdsOnEdge) lineIds.add(lineId);
  }
  return [...lineIds]
    .map((lineId) => graph.lines.get(lineId))
    .filter((line): line is Line => line !== undefined);
}

/** Returns one line that directly connects the two stations, if any. */
export function findDirectRoute(
  graph: MetroGraph,
  fromId: StationId,
  toId: StationId,
): Line | undefined {
  return getLinesAtStation(graph, fromId).find(
    (line) => line.stationIds.includes(toId),
  );
}

/**
 * Finds a route with the minimum number of line changes.
 *
 * BFS states are lines. Two lines are adjacent when they share a station;
 * reaching a destination line yields a route represented by an ordered array
 * of Line objects. The route length is the number of lines, so transfers are
 * route.length - 1.
 */
export function findRouteWithTransfer(
  graph: MetroGraph,
  fromId: StationId,
  toId: StationId,
): Line[] | undefined {
  if (fromId === toId) return [];

  const startLines = getLinesAtStation(graph, fromId);
  const targetLine = (line: Line) => line.stationIds.includes(toId);
  const queue: Line[] = [...startLines];
  const previous = new Map<string, string | undefined>();
  const visited = new Set<string>();

  for (const line of startLines) {
    visited.add(line.id);
    previous.set(line.id, undefined);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (targetLine(current)) {
      const routeIds: string[] = [];
      let lineId: string | undefined = current.id;
      while (lineId !== undefined) {
        routeIds.push(lineId);
        lineId = previous.get(lineId);
      }
      return routeIds.reverse().map((id) => graph.lines.get(id)!);
    }

    for (const stationId of current.stationIds) {
      for (const next of getLinesAtStation(graph, stationId)) {
        if (visited.has(next.id)) continue;
        visited.add(next.id);
        previous.set(next.id, current.id);
        queue.push(next);
      }
    }
  }

  return undefined;
}

/** Convenience object API for callers that prefer graph methods. */
export class SubwayGraph implements MetroGraph {
  readonly stations: ReadonlyMap<StationId, Station>;
  readonly lines: ReadonlyMap<string, Line>;
  readonly adjacency: AdjacencyTable;

  constructor(stations: readonly Station[], lines: readonly Line[]) {
    const graph = createMetroGraph(stations, lines);
    this.stations = graph.stations;
    this.lines = graph.lines;
    this.adjacency = graph.adjacency;
  }

  getLinesAtStation(stationId: StationId): Line[] {
    return getLinesAtStation(this, stationId);
  }

  findDirectRoute(fromId: StationId, toId: StationId): Line | undefined {
    return findDirectRoute(this, fromId, toId);
  }

  findRouteWithTransfer(fromId: StationId, toId: StationId): Line[] | undefined {
    return findRouteWithTransfer(this, fromId, toId);
  }
}
