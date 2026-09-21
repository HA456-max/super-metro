/**
 * Core domain types for the subway simulation.
 *
 * The model deliberately stores relationships by id. This keeps the data
 * serializable and avoids circular object references between lines and trains.
 */

export interface Position {
  x: number;
  y: number;
}

export type StationShape = "circle" | "triangle" | "square";

export interface Station {
  id: string;
  position: Position;
  shape: StationShape;
  waitingPassengers: Passenger[];
}

export interface Passenger {
  id: string;
  destinationShape: StationShape;
  currentStationId: string;
  targetStationId: string;
}

export interface Line {
  id: string;
  color: string;
  /** Stations are visited in this order; trains may travel in either direction. */
  stationIds: string[];
  trainIds: string[];
}

export interface Train {
  id: string;
  lineId: string;
  position: Position;
  speed: number;
  capacity: number;
  passengers: Passenger[];
}
