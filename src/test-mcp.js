const fetch = require('node-fetch');
const EventSourceModule = require('eventsource');
// ✅ SAFE IMPORT
const EventSource = EventSourceModule.EventSource || EventSourceModule;
const { randomUUID } = require('crypto');

// Configuration
const MCP_URL = 'http://localhost:3000';
// ⚠️ REPLACE WITH REAL PRODUCT ID
const TEST_PRODUCT_ID = '0630c72a-fcf3-4c76-b373-372a1fc67402'; 

/**
 * SIMULATES A SINGLE USER SESSION
 */
async function runUserSession(userLabel, intent) {
  const sessionId = randomUUID();
  console.log(`[${userLabel}] 🚀 Starting Session: ${sessionId}`);

  // 1. Connect SSE
  const sseUrl = `${MCP_URL}/sse?sessionId=${sessionId}`;
  const eventSource = new EventSource(sseUrl);
  
  // Internal tracking
  const pendingRequests = new Map();
  const requestId = Date.now() + Math.floor(Math.random() * 1000); // Random offset

  // 2. Setup Listener
  const responsePromise = new Promise((resolve, reject) => {
    // Timeout safety
    const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error(`[${userLabel}] ⏳ Timeout waiting for response`));
    }, 30000);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jsonrpc === '2.0' && data.id == requestId) {
            clearTimeout(timeout);
            if (data.result) resolve(data.result);
            else resolve(data); // Error case
        }
      } catch (err) { console.error(`[${userLabel}] Parse Error`, err); }
    };
    
    eventSource.onerror = (err) => {
        // console.log(`[${userLabel}] SSE Status:`, eventSource.readyState); 
    };
  });

  // Wait for connection
  await new Promise(r => setTimeout(r, 1000));
  console.log(`[${userLabel}] ✅ Connected. Sending: "${intent}"`);

  // 3. Send Request
  const postUrl = `${MCP_URL}/messages?sessionId=${sessionId}`;
  await fetch(postUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: 'run_godseye_analysis',
        arguments: {
          product_id: TEST_PRODUCT_ID,
          intent: intent
        }
      }
    })
  });

  // 4. Wait for Answer
  const start = Date.now();
  const result = await responsePromise;
  const duration = Date.now() - start;

  console.log(`[${userLabel}] 🏁 Finished in ${duration}ms`);
  
  if (result.content?.[0]?.text) {
      console.log(`[${userLabel}] ✅ Valid Response Received (${result.content[0].text.length} chars)`);
  } else {
      console.error(`[${userLabel}] ❌ Invalid/Empty Response`, result);
  }

  eventSource.close();
  return { user: userLabel, duration, success: !!result.content };
}

/**
 * RUNS THE CONCURRENT TEST
 */
async function runConcurrentTests() {
  console.log('==================================================');
  console.log('⚡ STARTING CONCURRENT USER TEST (v4.0.0)');
  console.log('==================================================\n');

  // Spawn two users simultaneously
  // User A asks for "Strategist" data (fast)
  // User B asks for "Detective" data (slower, needs enrichment)
  
  const userA = runUserSession('USER_A', 'How is my overall SOV performance?');
  const userB = runUserSession('USER_B', 'Why am I losing queries about pricing?');

  console.log('... Both users launched in parallel ...\n');

  try {
    const results = await Promise.all([userA, userB]);
    
    console.log('\n==================================================');
    console.log('🎉 CONCURRENCY TEST RESULTS');
    console.log('==================================================');
    console.table(results);
    
    if (results.every(r => r.success)) {
        console.log('\n✅ PASSED: Both users got unique responses simultaneously.');
    } else {
        console.log('\n❌ FAILED: One or more sessions dropped.');
    }

  } catch (err) {
      console.error('Fatal Test Error:', err);
  }
}

runConcurrentTests();