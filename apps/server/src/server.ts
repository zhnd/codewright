import { loggerConfig } from '@codewright/shared';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { validateEnv } from './infrastructure/env.js';
import { registerRoutes } from './infrastructure/routes/index.js';
import { seedWorkflowDefinitions } from './infrastructure/workflow-seed.js';
import { log } from './logger.js';

let env: ReturnType<typeof validateEnv>;
try {
  env = validateEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

async function main(): Promise<void> {
  const app = Fastify({
    logger: loggerConfig,
  });

  await app.register(cors, {
    origin: env.WEB_URL,
    credentials: true,
  });

  await seedWorkflowDefinitions();
  await registerRoutes(app);

  app.listen({ port: env.PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) throw err;
    app.log.info(`Server ready at: ${address}`);
  });
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
