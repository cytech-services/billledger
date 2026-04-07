import express from 'express';
import { z } from 'zod';

export type ParseBody = <T extends z.ZodTypeAny>(req: express.Request, res: express.Response, schema: T) => z.infer<T> | null;
