"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
async function main() {
    (0, app_1.connectDb)();
    (0, app_1.initDb)();
    await (0, app_1.runDailyMaintenance)();
    console.log(`Daily maintenance complete. DB: ${app_1.DB_PATH} backups: ${app_1.BACKUP_DIR}`);
}
main().catch((err) => {
    const e = err;
    console.error('Daily maintenance failed:', e.message);
    process.exit(1);
});
