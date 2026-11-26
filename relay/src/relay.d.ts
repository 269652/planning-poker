import type { WebSocket, WebSocketServer } from "ws";
import type { MemoryBus, RedisBus } from "./bus.js";

export function attachRelay(wss: WebSocketServer, bus: MemoryBus | RedisBus): void;
export function handleConnection(ws: WebSocket, url: string, bus: MemoryBus | RedisBus): void;
