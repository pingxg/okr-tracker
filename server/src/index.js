import config, { assertProductionConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';

assertProductionConfig();

if (process.env.SKIP_MIGRATIONS !== 'true') {
  await migrate();
}

const app = await buildApp();

const shutdown = async (signal) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
