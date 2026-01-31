import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { audit } from './middleware/audit';
import { rateLimit } from './middleware/rateLimit';
import devicesRouter from './routes/devices';
import releasesRouter from './routes/releases';
import { pool } from './db/pool';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit);
  app.use(morgan('combined'));
  app.use(audit(pool));

  app.use('/api/devices', devicesRouter);
  app.use('/api/releases', releasesRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}
