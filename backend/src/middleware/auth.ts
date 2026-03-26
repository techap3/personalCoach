import { Request, Response, NextFunction } from "express";

export interface AuthRequest extends Request {
  token?: string;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token" });
  }

  req.token = token;
  next();
}