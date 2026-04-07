import path from 'path';
import fsp from 'fs/promises';
import express from 'express';
import { z } from 'zod';
import type { ParseBody } from '../types/http';

type BackupListItem = { filename: string; size: number; created_at: string; reason: string };

type BackupsDeps = {
  parseBody: ParseBody;
  listBackups: () => Promise<BackupListItem[]>;
  getBackupStatus: () => Promise<{
    retention_days: number;
    backup_dir: string;
    total_backups: number;
    last_automatic_backup: BackupListItem | null;
  }>;
  createBackup: (reason?: string) => Promise<unknown>;
  pruneOldBackups: () => Promise<void>;
  connectDb: () => void;
  initDb: () => void;
  seedPaymentMethods: () => void;
  backupDir: string;
  dbPath: string;
};

export function registerBackupsRoutes(app: express.Express, deps: BackupsDeps) {
  app.get('/api/backups', async (_req, res) => {
    res.json(await deps.listBackups());
  });

  app.get('/api/backups/status', async (_req, res) => {
    res.json(await deps.getBackupStatus());
  });

  app.post('/api/backups', async (_req, res) => {
    const backup = await deps.createBackup('manual');
    await deps.pruneOldBackups();
    res.status(201).json({ ok: true, backup });
  });

  app.post('/api/backups/restore', async (req, res) => {
    const body = deps.parseBody(
      req,
      res,
      z.object({
        filename: z.string().trim().min(1)
      })
    );
    if (!body) return;
    const filename = path.basename(body.filename);
    if (!filename) {
      res.status(400).json({ error: 'filename is required' });
      return;
    }
    const backupPath = path.join(deps.backupDir, filename);
    try {
      await fsp.access(backupPath);
    } catch {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }

    await fsp.copyFile(backupPath, deps.dbPath);
    deps.connectDb();
    deps.initDb();
    deps.seedPaymentMethods();

    res.json({ ok: true, restored_from: filename });
  });

  app.get('/api/backups/:filename/download', async (req, res) => {
    const filename = path.basename(String(req.params.filename || '').trim());
    const backupPath = path.join(deps.backupDir, filename);
    try {
      await fsp.access(backupPath);
    } catch {
      res.status(404).json({ error: 'Backup not found' });
      return;
    }
    res.download(backupPath, filename);
  });
}
