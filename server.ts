/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * UniCloud Server Entry Point
 * Express API server with Vite middleware integration.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './src/server/api/routes';
import { logger } from './src/server/utils/logger';
import { validateSecurityConfiguration } from './src/server/utils/config';
import { sendApiError } from './src/server/utils/errors';
import { UserService } from './src/server/services/UserService';

async function startServer() {
  // Validate production security configuration & secrets before accepting traffic
  validateSecurityConfiguration();

  // Initialize demo user for seamless local and preview evaluation
  UserService.ensureDemoUser().catch((err) => {
    logger.debug('Demo user initialization note:', { message: err?.message });
  });

  const app = express();
  const PORT = 3000;

  // JSON request body parser & Cookie parser
  app.use(express.json());
  app.use(cookieParser());

  // Mount UniCloud API Routes
  app.use('/api', apiRouter);

  // Global API error handler ensuring clean JSON error responses
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendApiError(res, err);
  });

  // Vite middleware setup
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

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`UniCloud server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  logger.error('Failed to start UniCloud server', err);
  process.exit(1);
});
