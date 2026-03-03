import { Request, Response, NextFunction } from "express";
import { createClient, User } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
);

// Extend the Express Request interface
declare module "express-serve-static-core" {
    interface Request {
        user?: User | any;
    }
}

export const requireOAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check for a token in the Authorization header (Bearer token)
    // OR in the req.query.token (for SSE EventSource connections)
    let token = req.query.token as string;

    if (process.env.DEBUG_MODE === "true") {
        console.log(`[DEBUG][requireOAuth] Incoming Auth headers: ${req.headers.authorization || req.headers['Authorization'] || 'None'} | Query token: ${token ? 'Present' : 'None'}`);
    }

    if (!token) {
        // Express usually lowercases headers, but we check both just in case a proxy changes it
        const authHeader = req.headers.authorization || req.headers['Authorization'] as string;
        if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
            token = authHeader.substring(7);
        }
    }

    if (!token) {
        if (process.env.DEBUG_MODE === "true") console.log(`[DEBUG] No token found. Returning 401 with WWW-Authenticate: Bearer`);
        res.setHeader("WWW-Authenticate", "Bearer");
        res.status(401).json({ error: "Unauthorized: Missing token" });
        return;
    }

    if (process.env.DEBUG_MODE === "true") console.log(`[DEBUG] Found token, verifying with Supabase...`);

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            if (process.env.DEBUG_MODE === "true") console.log(`[DEBUG] Token invalid or expired. Error: ${error?.message}`);
            res.setHeader("WWW-Authenticate", "Bearer");
            res.status(401).json({ error: "Unauthorized: Invalid token" });
            return;
        }

        if (process.env.DEBUG_MODE === "true") console.log(`[DEBUG] Token verified successfully for user: ${user.id}`);
        // Attach the user to the request
        req.user = user;
        next();
    } catch (err: any) {
        if (process.env.DEBUG_MODE === "true") console.log(`[DEBUG] Token verification threw an error: ${err.message}`);
        res.setHeader("WWW-Authenticate", "Bearer");
        res.status(401).json({ error: "Unauthorized: Token verification failed" });
        return;
    }
};
