import { app, BACKUP_DIR, DB_PATH, PORT, startApp } from './app';

startApp();

app.listen(PORT, () => {
  console.log(`Bill Ledger API running on http://127.0.0.1:${PORT}`);
  console.log(`Using database at: ${DB_PATH}`);
  console.log(`Backups directory: ${BACKUP_DIR}`);
});

