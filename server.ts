/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Server Entry Point
 * Express API server with Vite middleware integration.
 * Used for local development (npm run dev) and containerized production (Cloud Run / Docker).
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { app } from './src/server/app.js';
import { logger } from './src/server/utils/logger.js';
import { validateSecurityConfiguration } from './src/server/utils/config.js';
import { ensureSchema } from './src/db/client.js';
import { UserService } from './src/server/services/UserService.js';

export async function startServer() {
  // Validate production security configuration & secrets before accepting traffic
  validateSecurityConfiguration();

  // Ensure PostgreSQL schema verification happens before requests proceed
  await ensureSchema();

  // Initialize demo user only in non-production environments
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production') {
    UserService.ensureDemoUser().catch((err) => {
      logger.debug('Demo user initialization note:', { message: err?.message });
    });
  }

  const PORT = 3000;

  // Vite middleware setup in development or static SPA serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`UniCloud server running on http://0.0.0.0:${PORT}`);
  });

  return server;
}

// Only auto-listen if executed directly in local or containerized environments (not in Vercel Functions)
if (!process.env.VERCEL) {
  startServer().catch((err) => {
    logger.error('Failed to start UniCloud server', err);
    process.exit(1);
  });
}

export { app };
export default app;
