import dotenv from 'dotenv';
import { createApp } from './app';
import { runMigrations } from './db/migrate';

dotenv.config();

async function bootstrap() {
  const port = parseInt(process.env.PORT || '4000', 10);
  await runMigrations();
  const app = createApp();
  app.listen(port, () => {
    console.log(`Platform API listening on port ${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
