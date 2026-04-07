import express from 'express';
import { z } from 'zod';

export function parseBody<T extends z.ZodTypeAny>(req: express.Request, res: express.Response, schema: T): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: result.error.flatten()
    });
    return null;
  }
  return result.data;
}
