import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Logger } from "pino";

export interface AuthRequest extends Request {
  token?: string;
  traceId?: string;
  log?: Logger;
  user?: {
    id: string;
    email?: string;
  };
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded: any = jwt.decode(token); // Supabase JWT

    if (!decoded?.sub) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.token = token;

    // 🔥 THIS FIXES YOUR ERROR
    req.user = {
      id: decoded.sub,
      email: decoded.email,
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: "Auth failed" });
  }
};