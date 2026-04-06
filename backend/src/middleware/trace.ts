import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import logger from "../logger";

export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  const traceId = randomUUID();

  (req as any).traceId = traceId;
  (req as any).log = logger.child({
    traceId,
    method: req.method,
    path: req.path,
  });

  res.setHeader("x-trace-id", traceId);
  next();
}
