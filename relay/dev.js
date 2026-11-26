// Local relay for development: ws://localhost:8788/api/relay (in-memory bus unless REDIS_URL is set).
import { busFromEnv } from "./src/bus.js";
import { createRelayServer } from "./src/server.js";

const port = Number(process.env.PORT ?? 8788);
const bus = busFromEnv(process.env);
createRelayServer(bus).listen(port, () => {
  console.log(`Planning Poker relay on ws://localhost:${port}/api/relay (${bus.kind} bus)`);
});
