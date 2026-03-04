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
    // Determine the base domain for the resource_metadata pointer (RFC 9728)
    const domain = process.env.MCP_SERVER_DOMAIN || `http://localhost:${process.env.PORT || 3000}`;
    const authHeaderValue = `Bearer realm="mcp", resource_metadata="${domain}/.well-known/oauth-protected-resource"`;

    if (process.env.DEBUG_MODE === "true") {
        console.log(`[DEBUG WORKFLOW] 🔒 requireOAuth middleware invoked for ${req.method} ${req.url}`);
        console.log(`[DEBUG WORKFLOW] 🔒 WWW-Authenticate will use: ${authHeaderValue}`);
    }

    // Check for a token in the Authorization header (Bearer token)
    // OR in the req.query.token (for SSE EventSource connections)
    let token = req.query.token as string;

    if (process.env.DEBUG_MODE === "true" && token) {
        console.log(`[DEBUG WORKFLOW] 🔍 Found token in query parameters (length: ${token.length})`);
    }

    if (!token) {
        // Express usually lowercases headers, but we check both just in case a proxy changes it
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
        if (process.env.DEBUG_MODE === "true") {
            console.log(`[DEBUG WORKFLOW] ⛔ No token found. Returning 401 with WWW-Authenticate header to trigger client OAuth flow.`);
        }
        res.setHeader("WWW-Authenticate", authHeaderValue);
        res.status(401).json({ error: "Unauthorized: Missing token" });
        return;
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
            res.setHeader("WWW-Authenticate", authHeaderValue);
            res.status(401).json({ error: "Unauthorized: Invalid token" });
            return;
        }

        if (process.env.DEBUG_MODE === "true") {
            console.log(`[DEBUG WORKFLOW] ✅ Token verified successfully. User ID: ${user.id}`);
        }
        // Attach the user to the request
        req.user = user;
        next();
    } catch (err: any) {
        if (process.env.DEBUG_MODE === "true") {
            console.error(`[DEBUG WORKFLOW] 💥 Fatal error during token verification:`, err.message || err);
        }
        res.setHeader("WWW-Authenticate", authHeaderValue);
        res.status(401).json({ error: "Unauthorized: Token verification failed" });
        return;
    }
};
