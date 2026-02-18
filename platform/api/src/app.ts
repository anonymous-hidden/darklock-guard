import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { audit } from './middleware/audit';
import { rateLimit } from './middleware/rateLimit';
import devicesRouter from './routes/devices';
import releasesRouter from './routes/releases';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import adminRouter from './routes/admin';
import { pool } from './db/pool';

export function createApp() {
  const app = express();

  // CORS configuration for development (allows cookies from Vite dev server)
  if (process.env.NODE_ENV !== 'production') {
    app.use(
      cors({
        origin: 'http://localhost:5173',
        credentials: true,
      })
    );
  }

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Session configuration
  const sessionSecret = process.env.SESSION_SECRET || process.env.API_JWT_SECRET || 'darklock-dev-secret-change-me';
  app.use(
    session({
      name: 'dlg.sid',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );

  app.use(rateLimit);
  app.use(morgan('combined'));
  app.use(audit(pool));

  // Auth routes (session-based, for web dashboard)
  app.use('/api/auth', authRouter);

  // Dashboard routes (session-authenticated)
  app.use('/api/dashboard', dashboardRouter);

  // Admin routes (admin-only + public telemetry ingestion)
  app.use('/api/admin', adminRouter);

  // Device-facing routes (JWT-authenticated)
  app.use('/api/devices', devicesRouter);
  app.use('/api/releases', releasesRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}
