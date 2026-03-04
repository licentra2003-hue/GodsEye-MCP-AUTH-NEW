import { Request, Response, NextFunction } from "express";
import { createClient, User } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

declare module "express-serve-static-core" {
    interface Request {
        user?: User | any;
    }
}

export const requireOAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Determine if this is an SSE connection
    const isSSE = req.path.includes('/sse') || req.headers.accept?.includes('text/event-stream');

    // 2. Helper function to handle 401s without crashing Claude's strict EventSource parser
    const sendUnauthorized = (message: string) => {
        res.setHeader("WWW-Authenticate", "Bearer");
        if (isSSE) {
            // CRITICAL FIX: Send 401 as a valid text stream with JSON-encoded data
            res.setHeader("Content-Type", "text/event-stream");
            res.status(401).send(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        } else {
            // Send standard JSON for all other routes
            res.setHeader("Content-Type", "application/json");
            res.status(401).json({ error: message });
        }
    };

    let token = req.query.token as string;

    if (!token) {
        const authHeader = req.headers.authorization || req.headers['Authorization'] as string;
        if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
            token = authHeader.substring(7);
        }
    }

    if (!token) {
        return sendUnauthorized("Unauthorized: Missing token");
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return sendUnauthorized(`Unauthorized: ${error ? error.message : "Invalid token"}`);
        }

        req.user = user;
        next();
    } catch (err: any) {
        return sendUnauthorized("Unauthorized: Token verification failed");
    }
};
