import { BACKUP_DIR, DB_PATH, connectDb, initDb, runDailyMaintenance } from './app';

async function main() {
  connectDb();
  initDb();
  await runDailyMaintenance();
  console.log(`Daily maintenance complete. DB: ${DB_PATH} backups: ${BACKUP_DIR}`);
}

main().catch((err) => {
  const e = err as Error;
  console.error('Daily maintenance failed:', e.message);
  process.exit(1);
});
