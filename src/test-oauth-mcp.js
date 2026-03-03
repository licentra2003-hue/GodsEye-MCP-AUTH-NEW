const fetch = require('node-fetch');
const EventSourceModule = require('eventsource');
const EventSource = EventSourceModule.EventSource || EventSourceModule;
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const MCP_URL = 'http://localhost:3000';
const TEST_PRODUCT_ID = '0630c72a-fcf3-4c76-b373-372a1fc67402';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ════════════════════════════════════════════════════════════
// TEST 1: No Token at all (Simulates Claude's FIRST connection)
// Expected: 401 Unauthorized + WWW-Authenticate: Bearer header
// This is what tells Claude "go trigger the OAuth login flow"
// ════════════════════════════════════════════════════════════
async function testNoToken() {
    console.log("\n══════════════════════════════════════════════════");
    console.log("TEST 1: NO TOKEN (Claude's first-ever connection)");
    console.log("══════════════════════════════════════════════════");

    try {
        const resp = await fetch(`${MCP_URL}/sse`, {
            method: 'GET',
            redirect: 'manual', // Don't follow redirects
        });

        console.log(`HTTP Status:          ${resp.status}`);
        console.log(`WWW-Authenticate:     ${resp.headers.get('www-authenticate') || 'NOT PRESENT'}`);
        const body = await resp.json().catch(() => resp.text());
        console.log(`Response Body:        ${JSON.stringify(body)}`);

        if (resp.status === 401 && resp.headers.get('www-authenticate') === 'Bearer') {
            console.log("✅ PASSED: Server correctly returned 401 + WWW-Authenticate: Bearer");
            console.log("   → This is exactly what triggers Claude's built-in OAuth login popup.");
        } else {
            console.log("❌ FAILED: Expected 401 with WWW-Authenticate: Bearer header");
        }
    } catch (err) {
        console.error("❌ ERROR:", err.message);
    }
}

// ════════════════════════════════════════════════════════════
// TEST 2: Invalid / Expired Token
// Expected: 401 Unauthorized + WWW-Authenticate: Bearer
// Simulates a user whose session expired or token was tampered
// ════════════════════════════════════════════════════════════
async function testInvalidToken() {
    console.log("\n══════════════════════════════════════════════════");
    console.log("TEST 2: INVALID TOKEN (expired / tampered JWT)");
    console.log("══════════════════════════════════════════════════");

    const fakeToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    try {
        const resp = await fetch(`${MCP_URL}/sse?token=${fakeToken}`, {
            method: 'GET',
            redirect: 'manual',
        });

        console.log(`HTTP Status:          ${resp.status}`);
        console.log(`WWW-Authenticate:     ${resp.headers.get('www-authenticate') || 'NOT PRESENT'}`);
        const body = await resp.json().catch(() => resp.text());
        console.log(`Response Body:        ${JSON.stringify(body)}`);

        if (resp.status === 401 && resp.headers.get('www-authenticate') === 'Bearer') {
            console.log("✅ PASSED: Server correctly rejected the fake token.");
            console.log("   → Claude would re-trigger the OAuth flow to get a fresh token.");
        } else {
            console.log("❌ FAILED: Expected 401 with WWW-Authenticate: Bearer header");
        }
    } catch (err) {
        console.error("❌ ERROR:", err.message);
    }
}

// ════════════════════════════════════════════════════════════
// TEST 3: Valid Token but WRONG user tries to access product
// Expected: Tool returns "Product not found, or you do not
//           have permission to access it."
// This validates DATA ISOLATION at the DB level.
// ════════════════════════════════════════════════════════════
async function testWrongUserDataIsolation() {
    console.log("\n══════════════════════════════════════════════════");
    console.log("TEST 3: WRONG USER (Data Isolation Check)");
    console.log("══════════════════════════════════════════════════");

    const email = `wrong_user_${Date.now()}@example.com`;
    const password = "password123";
    let testUserId = null;

    try {
        console.log("Creating an outsider user (does NOT own the product)...");
        const { data: signupData, error: signupError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });
        if (signupError) throw new Error("Signup failed: " + signupError.message);
        testUserId = signupData.user.id;

        const { data: signinData, error: signinError } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (signinError) throw new Error("Signin failed: " + signinError.message);

        const token = signinData.session.access_token;
        console.log(`✅ Outsider authenticated. User: ${testUserId}`);

        // Connect SSE with valid token
        const sseUrl = `${MCP_URL}/sse?token=${token}`;
        const eventSource = new EventSource(sseUrl);

        let serverSessionId = null;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
            eventSource.addEventListener('endpoint', (event) => {
                clearTimeout(timeout);
                const url = new URL(event.data, MCP_URL);
                serverSessionId = url.searchParams.get('sessionId');
                console.log(`✅ SSE Connected. Session: ${serverSessionId}`);
                resolve();
            });
            eventSource.onerror = () => { clearTimeout(timeout); reject(new Error("SSE Error")); };
        });

        console.log("Attempting to access product owned by SOMEONE ELSE...");
        const resp = await fetch(`${MCP_URL}/messages?sessionId=${serverSessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: 'run_godseye_analysis',
                    arguments: {
                        product_id: TEST_PRODUCT_ID,
                        intent: "Give me a quick summary"
                    }
                }
            })
        });

        console.log(`HTTP POST Status: ${resp.status}`);

        const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 25000);
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.id === 1) {
                    clearTimeout(timeout);
                    resolve(data.result);
                }
            };
        });

        eventSource.close();

        if (result && result.content && result.content[0]) {
            const text = result.content[0].text;
            console.log(`Response: ${text}`);
            if (text.includes("permission to access it") || text.includes("not found")) {
                console.log("✅ PASSED: Data Isolation working! Outsider was blocked.");
            } else {
                console.log("❌ FAILED: Outsider was able to access someone else's product!");
            }
        } else {
            console.log("❌ FAILED: No response received (timeout).");
        }

    } catch (err) {
        console.error("❌ ERROR:", err.message);
    } finally {
        if (testUserId) {
            await supabase.auth.admin.deleteUser(testUserId);
            console.log("🧹 Outsider user deleted.");
        }
    }
}

// ════════════════════════════════════════════════════════════
// TEST 4: Valid Token + Correct Owner = SUCCESS
// Expected: Full data returned from GodsEye
// ════════════════════════════════════════════════════════════
async function testValidOwnerSuccess() {
    console.log("\n══════════════════════════════════════════════════");
    console.log("TEST 4: VALID OWNER (Should return real data)");
    console.log("══════════════════════════════════════════════════");

    const email = `owner_${Date.now()}@example.com`;
    const password = "password123";
    let testUserId = null;
    let originalOwnerId = null;

    try {
        const { data: product } = await supabase
            .from('products')
            .select('user_id')
            .eq('id', TEST_PRODUCT_ID)
            .maybeSingle();

        originalOwnerId = product.user_id;

        const { data: signupData, error: signupError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });
        if (signupError) throw new Error("Signup failed: " + signupError.message);
        testUserId = signupData.user.id;

        // Temporarily assign ownership
        await supabase
            .from('products')
            .update({ user_id: testUserId })
            .eq('id', TEST_PRODUCT_ID);

        const { data: signinData, error: signinError } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (signinError) throw new Error("Signin failed: " + signinError.message);

        const token = signinData.session.access_token;
        console.log(`✅ Owner authenticated. User: ${testUserId}`);

        const sseUrl = `${MCP_URL}/sse?token=${token}`;
        const eventSource = new EventSource(sseUrl);

        let serverSessionId = null;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
            eventSource.addEventListener('endpoint', (event) => {
                clearTimeout(timeout);
                const url = new URL(event.data, MCP_URL);
                serverSessionId = url.searchParams.get('sessionId');
                console.log(`✅ SSE Connected. Session: ${serverSessionId}`);
                resolve();
            });
            eventSource.onerror = () => { clearTimeout(timeout); reject(new Error("SSE Error")); };
        });

        console.log("Requesting analysis as the LEGITIMATE owner...");
        await fetch(`${MCP_URL}/messages?sessionId=${serverSessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: 'run_godseye_analysis',
                    arguments: {
                        product_id: TEST_PRODUCT_ID,
                        intent: "Quick performance summary"
                    }
                }
            })
        });

        const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 25000);
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.id === 1) {
                    clearTimeout(timeout);
                    resolve(data.result);
                }
            };
        });

        eventSource.close();

        if (result && result.content && result.content[0]) {
            const text = result.content[0].text;
            console.log(`Response (first 300 chars): ${text.substring(0, 300)}...`);
            if (text.includes("GODSEYE") || text.includes("SOV") || text.includes("Score")) {
                console.log("✅ PASSED: Legitimate owner received full analysis data!");
            } else {
                console.log("❌ FAILED: Response didn't contain expected data.");
            }
        } else {
            console.log("❌ FAILED: No response received (timeout).");
        }

    } catch (err) {
        console.error("❌ ERROR:", err.message);
    } finally {
        if (originalOwnerId) {
            await supabase.from('products').update({ user_id: originalOwnerId }).eq('id', TEST_PRODUCT_ID);
        }
        if (testUserId) {
            await supabase.auth.admin.deleteUser(testUserId);
        }
        console.log("🧹 Cleanup done.");
    }
}

// ════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ════════════════════════════════════════════════════════════
async function runAllTests() {
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║   🔐 GODSEYE MCP OAUTH AUTHENTICATION SUITE     ║");
    console.log("╚══════════════════════════════════════════════════╝");

    await testNoToken();           // → 401 + WWW-Authenticate: Bearer
    await testInvalidToken();      // → 401 + WWW-Authenticate: Bearer
    await testWrongUserDataIsolation(); // → Tool rejects with "no permission"
    await testValidOwnerSuccess(); // → Full data returned

    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║   🏁 ALL TESTS COMPLETE                          ║");
    console.log("╚══════════════════════════════════════════════════╝");
    process.exit();
}

runAllTests();
