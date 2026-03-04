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
    if (process.env.DEBUG_MODE === "true") {
        console.log(`[DEBUG WORKFLOW] 🔒 requireOAuth middleware invoked for ${req.method} ${req.url}`);
    }

    // Determine if this is an SSE connection so we can format the 401 error correctly
    const isSSE = req.path.includes('/sse') || req.headers.accept?.includes('text/event-stream');

    if (process.env.DEBUG_MODE === "true") {
        console.log(`[DEBUG WORKFLOW] 🔍 isSSE=${isSSE}, path=${req.path}, accept=${req.headers.accept}`);
    }

    // Helper function to handle 401s without crashing Claude's strict EventSource parser
    const sendUnauthorized = (message: string) => {
        if (process.env.DEBUG_MODE === "true") {
            console.log(`[DEBUG WORKFLOW] ⛔ Sending 401: "${message}" (isSSE=${isSSE})`);
        }
        res.setHeader("WWW-Authenticate", "Bearer");
        if (isSSE) {
            res.setHeader("Content-Type", "text/event-stream");
            res.status(401).send(`event: error\ndata: ${message}\n\n`);
        } else {
            res.status(401).json({ error: message });
        }
    };

    let token = req.query.token as string;

    if (process.env.DEBUG_MODE === "true" && token) {
        console.log(`[DEBUG WORKFLOW] 🔍 Found token in query parameters (length: ${token.length})`);
    }

    if (!token) {
        const authHeader = req.headers.authorization || req.headers['Authorization'] as string;
        if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
            token = authHeader.substring(7);
            if (process.env.DEBUG_MODE === "true") {
                console.log(`[DEBUG WORKFLOW] 🔍 Extracted Bearer token from header (length: ${token.length})`);
            }
        } else if (process.env.DEBUG_MODE === "true" && authHeader) {
            console.log(`[DEBUG WORKFLOW] ❌ Auth header found but not starting with 'Bearer ': ${authHeader.substring(0, 15)}...`);
        }
    }

    if (!token) {
        return sendUnauthorized("Unauthorized: Missing token");
    }

    try {
        if (process.env.DEBUG_MODE === "true") {
            console.log(`[DEBUG WORKFLOW] 🧠 Verifying token with Supabase...`);
        }
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            if (process.env.DEBUG_MODE === "true") {
                console.log(`[DEBUG WORKFLOW] ⛔ Supabase rejected token:`, error ? error.message : "No user returned");
            }
            return sendUnauthorized(`Unauthorized: ${error ? error.message : "Invalid token"}`);
        }

        if (process.env.DEBUG_MODE === "true") {
            console.log(`[DEBUG WORKFLOW] ✅ Token verified successfully. User ID: ${user.id}`);
        }
        req.user = user;
        next();
    } catch (err: any) {
        if (process.env.DEBUG_MODE === "true") {
            console.error(`[DEBUG WORKFLOW] 💥 Fatal error during token verification:`, err.message || err);
        }
        return sendUnauthorized("Unauthorized: Token verification failed");
    }
};
