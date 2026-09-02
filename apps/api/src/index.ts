import { createApp } from "./app.js";
import { loadConfig } from "./env.js";

const config = loadConfig();
const app = createApp({ config });

// Vercel's Express support recognises both a default export and a port listener.
app.listen(config.port, () => {
  console.log(`Strada API listening on :${config.port}`);
});

export default app;
