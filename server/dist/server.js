"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
(0, app_1.startApp)();
app_1.app.listen(app_1.PORT, () => {
    console.log(`Bill Ledger API running on http://127.0.0.1:${app_1.PORT}`);
    console.log(`Using database at: ${app_1.DB_PATH}`);
    console.log(`Backups directory: ${app_1.BACKUP_DIR}`);
});
