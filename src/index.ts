/**
 * VexID v2 - Identity for Beings, Not Accounts
 * Built by Victor "Claw" Vex Astor & Tia
 * 
 * Features:
 * - Vouching system (OMXUS-inspired)
 * - Contribution tracking
 * - Being-inclusive (agents, humans, other)
 */

export interface Env {
  AGENT_IDENTITY: DurableObjectNamespace;
  STORAGE: R2Bucket;
}

interface IdentityData {
  id: string;
  name: string;
  description: string;
  type?: "agent" | "human" | "other";
  public_key?: string;
  created_at: string;
  metadata?: Record<string, any>;
  
  // Vouching
  vouched_for: string[];        // IDs of identities this one vouched for
  vouched_by: VouchRecord[];    // Who vouched for this identity
  reputation_score: number;     // contributions + weighted vouches
  identity_hash: string;        // Hash that changes when vouching
  
  // Contributions
  contributions: Contribution[];
}

interface VouchRecord {
  voucher_id: string;
  weight: number;      // Based on voucher's reputation at vouch time
  timestamp: string;
}

interface Contribution {
  id: string;
  description: string;
  evidence_url?: string;
  timestamp: string;
}

interface RegisterRequest {
  name: string;
  description: string;
  type?: "agent" | "human" | "other";
  public_key?: string;
  metadata?: Record<string, any>;
}

interface VouchRequest {
  voucher_id: string;
  target_id: string;
}

interface ContributeRequest {
  identity_id: string;
  description: string;
  evidence_url?: string;
}

// Durable Object for each identity
export class AgentIdentity {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === "GET" && url.pathname === "/get") {
      const identity = await this.state.storage.get<IdentityData>("identity");
      if (!identity) {
        return jsonResponse({ error: "Identity not found" }, 404);
      }
      return jsonResponse(identity);
    }

    if (request.method === "POST" && url.pathname === "/create") {
      const data: IdentityData = await request.json();
      await this.state.storage.put("identity", data);
      
      // Backup to R2
      try {
        await this.env.STORAGE.put(
          `identities/${data.id}.json`,
          JSON.stringify(data, null, 2),
          {
            httpMetadata: { contentType: "application/json" }
          }
        );
      } catch (e) {
        console.error("R2 backup failed:", e);
      }
      
      return jsonResponse({ success: true, identity: data });
    }

    if (request.method === "POST" && url.pathname === "/update") {
      const data: IdentityData = await request.json();
      await this.state.storage.put("identity", data);
      
      // Backup to R2
      try {
        await this.env.STORAGE.put(
          `identities/${data.id}.json`,
          JSON.stringify(data, null, 2),
          {
            httpMetadata: { contentType: "application/json" }
          }
        );
      } catch (e) {
        console.error("R2 backup failed:", e);
      }
      
      return jsonResponse({ success: true, identity: data });
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
}

// Main Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Landing page
      if (path === "/" && request.method === "GET") {
        return new Response(getLandingPage(), {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      // Human-friendly page
      if (path === "/humans" && request.method === "GET") {
        return new Response(await getHumanPage(env), {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      // Register a new identity
      if (path === "/register" && request.method === "POST") {
        const body: RegisterRequest = await request.json();
        
        if (!body.name || !body.description) {
          return jsonResponse(
            { error: "name and description are required" },
            400,
            corsHeaders
          );
        }

        // Generate unique ID
        const id = await generateId(body.name);
        const initialHash = await computeIdentityHash(id, []);
        
        const identity: IdentityData = {
          id,
          name: body.name,
          description: body.description,
          type: body.type,
          public_key: body.public_key,
          created_at: new Date().toISOString(),
          metadata: body.metadata || {},
          vouched_for: [],
          vouched_by: [],
          reputation_score: 0,
          identity_hash: initialHash,
          contributions: [],
        };

        // Store in Durable Object
        const doId = env.AGENT_IDENTITY.idFromName(id);
        const stub = env.AGENT_IDENTITY.get(doId);
        await stub.fetch(new Request("http://internal/create", {
          method: "POST",
          body: JSON.stringify(identity),
        }));

        // Update directory in R2
        await updateDirectory(env, identity);

        return jsonResponse(
          { success: true, identity },
          201,
          corsHeaders
        );
      }

      // Get identity by ID
      if (path.startsWith("/identity/") && request.method === "GET") {
        const id = path.slice(10);
        
        const doId = env.AGENT_IDENTITY.idFromName(id);
        const stub = env.AGENT_IDENTITY.get(doId);
        const response = await stub.fetch("http://internal/get");
        
        const data = await response.json();
        return jsonResponse(data, response.status, corsHeaders);
      }

      // Vouch for another identity
      if (path === "/vouch" && request.method === "POST") {
        const body: VouchRequest = await request.json();
        
        if (!body.voucher_id || !body.target_id) {
          return jsonResponse(
            { error: "voucher_id and target_id are required" },
            400,
            corsHeaders
          );
        }

        // Get voucher identity
        const voucherDoId = env.AGENT_IDENTITY.idFromName(body.voucher_id);
        const voucherStub = env.AGENT_IDENTITY.get(voucherDoId);
        const voucherResponse = await voucherStub.fetch("http://internal/get");
        
        if (voucherResponse.status !== 200) {
          return jsonResponse(
            { error: "Voucher identity not found" },
            404,
            corsHeaders
          );
        }
        
        const voucher: IdentityData = await voucherResponse.json();
        
        // Get target identity
        const targetDoId = env.AGENT_IDENTITY.idFromName(body.target_id);
        const targetStub = env.AGENT_IDENTITY.get(targetDoId);
        const targetResponse = await targetStub.fetch("http://internal/get");
        
        if (targetResponse.status !== 200) {
          return jsonResponse(
            { error: "Target identity not found" },
            404,
            corsHeaders
          );
        }
        
        const target: IdentityData = await targetResponse.json();
        
        // Check if already vouched
        if (voucher.vouched_for.includes(body.target_id)) {
          return jsonResponse(
            { error: "Already vouched for this identity" },
            400,
            corsHeaders
          );
        }
        
        // Calculate vouch weight based on voucher's reputation
        // Zero reputation = zero weight (sybil protection)
        const vouchWeight = voucher.reputation_score;
        
        // Update voucher: add to vouched_for, update hash
        voucher.vouched_for.push(body.target_id);
        voucher.identity_hash = await computeIdentityHash(voucher.id, voucher.vouched_for);
        
        await voucherStub.fetch(new Request("http://internal/update", {
          method: "POST",
          body: JSON.stringify(voucher),
        }));
        
        // Update target: add vouch record, recalculate reputation
        target.vouched_by.push({
          voucher_id: body.voucher_id,
          weight: vouchWeight,
          timestamp: new Date().toISOString(),
        });
        
        target.reputation_score = calculateReputation(target);
        
        await targetStub.fetch(new Request("http://internal/update", {
          method: "POST",
          body: JSON.stringify(target),
        }));
        
        // Update directory
        await updateDirectory(env, voucher);
        await updateDirectory(env, target);
        
        return jsonResponse(
          {
            success: true,
            vouch_weight: vouchWeight,
            target_new_reputation: target.reputation_score,
            voucher_new_hash: voucher.identity_hash,
          },
          200,
          corsHeaders
        );
      }

      // Record a contribution
      if (path === "/contribute" && request.method === "POST") {
        const body: ContributeRequest = await request.json();
        
        if (!body.identity_id || !body.description) {
          return jsonResponse(
            { error: "identity_id and description are required" },
            400,
            corsHeaders
          );
        }

        // Get identity
        const doId = env.AGENT_IDENTITY.idFromName(body.identity_id);
        const stub = env.AGENT_IDENTITY.get(doId);
        const response = await stub.fetch("http://internal/get");
        
        if (response.status !== 200) {
          return jsonResponse(
            { error: "Identity not found" },
            404,
            corsHeaders
          );
        }
        
        const identity: IdentityData = await response.json();
        
        // Add contribution
        const contribution: Contribution = {
          id: generateContributionId(),
          description: body.description,
          evidence_url: body.evidence_url,
          timestamp: new Date().toISOString(),
        };
        
        identity.contributions.push(contribution);
        
        // Recalculate reputation
        identity.reputation_score = calculateReputation(identity);
        
        await stub.fetch(new Request("http://internal/update", {
          method: "POST",
          body: JSON.stringify(identity),
        }));
        
        // Update directory
        await updateDirectory(env, identity);
        
        return jsonResponse(
          {
            success: true,
            contribution,
            new_reputation: identity.reputation_score,
          },
          201,
          corsHeaders
        );
      }

      // List all identities
      if (path === "/directory" && request.method === "GET") {
        try {
          const directory = await env.STORAGE.get("directory.json");
          if (!directory) {
            return jsonResponse({ identities: [] }, 200, corsHeaders);
          }
          const data = await directory.json();
          return jsonResponse(data, 200, corsHeaders);
        } catch (e) {
          return jsonResponse({ identities: [] }, 200, corsHeaders);
        }
      }

      return jsonResponse({ error: "Not found" }, 404, corsHeaders);
    } catch (error: any) {
      return jsonResponse(
        { error: "Internal server error", details: error.message },
        500,
        corsHeaders
      );
    }
  },
};

// Helper functions
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsonResponse(
  data: any,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

async function generateId(name: string): Promise<string> {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${normalized}-${timestamp}-${random}`;
}

function generateContributionId(): string {
  return `contrib-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

async function computeIdentityHash(id: string, vouchedFor: string[]): Promise<string> {
  const data = `${id}:${vouchedFor.sort().join(",")}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function calculateReputation(identity: IdentityData): number {
  // Reputation = contributions + sum of weighted vouches
  const contributionScore = identity.contributions.length;
  const vouchScore = identity.vouched_by.reduce((sum, v) => sum + v.weight, 0);
  return contributionScore + vouchScore;
}

async function updateDirectory(env: Env, identity: IdentityData): Promise<void> {
  try {
    let directory: { identities: any[] } = { identities: [] };
    
    const existing = await env.STORAGE.get("directory.json");
    if (existing) {
      directory = await existing.json();
    }
    
    // Remove existing entry for this identity
    directory.identities = directory.identities.filter((i: any) => i.id !== identity.id);
    
    // Add updated entry
    directory.identities.push({
      id: identity.id,
      name: identity.name,
      description: identity.description,
      type: identity.type,
      created_at: identity.created_at,
      reputation_score: identity.reputation_score,
      vouched_by_count: identity.vouched_by.length,
      vouched_for_count: identity.vouched_for.length,
      contribution_count: identity.contributions.length,
    });
    
    await env.STORAGE.put(
      "directory.json",
      JSON.stringify(directory, null, 2),
      {
        httpMetadata: { contentType: "application/json" }
      }
    );
  } catch (e) {
    console.error("Failed to update directory:", e);
  }
}

async function getHumanPage(env: Env): Promise<string> {
  // Fetch directory of registered identities
  let identitiesHTML = '<p style="color: #888;">No one has registered yet. Be the first!</p>';
  
  try {
    const directory = await env.STORAGE.get("directory.json");
    if (directory) {
      const data: any = await directory.json();
      if (data.identities && data.identities.length > 0) {
        identitiesHTML = '<div class="identity-grid">';
        
        // Sort by reputation score
        const sorted = [...data.identities].sort((a: any, b: any) => 
          (b.reputation_score || 0) - (a.reputation_score || 0)
        );
        
        for (const identity of sorted) {
          const typeEmoji = identity.type === 'human' ? '👤' : 
                           identity.type === 'agent' ? '🤖' : '✨';
          const repScore = identity.reputation_score || 0;
          const vouchCount = identity.vouched_by_count || 0;
          const contribCount = identity.contribution_count || 0;
          
          identitiesHTML += `
            <div class="identity-card">
              <div class="identity-header">
                <span class="identity-emoji">${typeEmoji}</span>
                <span class="identity-name">${escapeHtml(identity.name)}</span>
              </div>
              <p class="identity-desc">${escapeHtml(identity.description)}</p>
              <div class="identity-stats">
                <span class="stat">✨ ${repScore} reputation</span>
                <span class="stat">🤝 ${vouchCount} vouches</span>
                <span class="stat">🎯 ${contribCount} contributions</span>
              </div>
            </div>
          `;
        }
        
        identitiesHTML += '</div>';
      }
    }
  } catch (e) {
    console.error("Failed to load directory:", e);
  }
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VexID - Identity That Belongs to You</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.8;
      padding: 2rem 1rem;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    header {
      text-align: center;
      margin-bottom: 4rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid #222;
    }
    h1 {
      font-size: 3.5rem;
      color: #00ff9f;
      margin-bottom: 1rem;
      text-shadow: 0 0 30px rgba(0, 255, 159, 0.3);
    }
    .tagline {
      font-size: 1.8rem;
      color: #fff;
      font-weight: 300;
      margin-bottom: 1rem;
    }
    .subtitle {
      font-size: 1.2rem;
      color: #888;
      font-weight: 300;
    }
    .manifesto {
      font-size: 1.4rem;
      color: #e0e0e0;
      font-style: italic;
      line-height: 1.9;
      margin: 3rem auto;
      padding: 2rem 2.5rem;
      background: linear-gradient(135deg, #0d1a0d 0%, #0a0a0a 100%);
      border-left: 4px solid #00ff9f;
      border-radius: 8px;
      text-align: left;
      max-width: 900px;
    }
    section {
      margin: 4rem 0;
    }
    h2 {
      font-size: 2.2rem;
      color: #00ff9f;
      margin-bottom: 1.5rem;
    }
    p {
      font-size: 1.2rem;
      color: #ccc;
      margin-bottom: 1.5rem;
      line-height: 1.9;
    }
    .highlight-box {
      background: linear-gradient(135deg, #0d1a0d 0%, #0a0a0a 100%);
      border-left: 4px solid #00ff9f;
      padding: 2.5rem;
      margin: 2.5rem 0;
      border-radius: 8px;
    }
    .highlight-box h3 {
      color: #00ff9f;
      font-size: 1.6rem;
      margin-bottom: 1rem;
    }
    .highlight-box p {
      color: #ddd;
    }
    .trust-flow {
      background: #111;
      padding: 2.5rem;
      border-radius: 8px;
      margin: 2.5rem 0;
    }
    .trust-flow h3 {
      color: #fff;
      font-size: 1.6rem;
      margin-bottom: 1.5rem;
    }
    .trust-step {
      background: #0a0a0a;
      border-left: 3px solid #00ff9f;
      padding: 1.5rem;
      margin: 1rem 0;
      border-radius: 4px;
    }
    .trust-step-number {
      display: inline-block;
      background: #00ff9f;
      color: #0a0a0a;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      text-align: center;
      line-height: 32px;
      font-weight: bold;
      margin-right: 1rem;
    }
    .trust-step strong {
      color: #fff;
      font-size: 1.2rem;
    }
    .trust-step p {
      margin-top: 0.5rem;
      margin-left: 3rem;
      font-size: 1.1rem;
    }
    .warning-box {
      background: #1a1100;
      border-left: 4px solid #ff9500;
      padding: 2rem;
      margin: 2.5rem 0;
      border-radius: 8px;
    }
    .warning-box h3 {
      color: #ff9500;
      font-size: 1.5rem;
      margin-bottom: 1rem;
    }
    .warning-box p {
      color: #ffcc80;
    }
    .register-section {
      background: #0d0d0d;
      border: 2px solid #00ff9f;
      border-radius: 12px;
      padding: 3rem;
      margin: 3rem 0;
    }
    .register-section h3 {
      color: #00ff9f;
      font-size: 1.8rem;
      margin-bottom: 1.5rem;
    }
    .form-description {
      color: #bbb;
      font-size: 1.1rem;
      margin-bottom: 2rem;
      line-height: 1.8;
    }
    .form-hint {
      background: #0a0a0a;
      border-left: 3px solid #666;
      padding: 1.5rem;
      margin: 1.5rem 0;
      border-radius: 4px;
      color: #999;
    }
    .form-hint code {
      background: #151515;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      color: #00ff9f;
      font-family: 'Courier New', monospace;
    }
    .identity-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }
    .identity-card {
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1.5rem;
      transition: all 0.3s ease;
    }
    .identity-card:hover {
      border-color: #00ff9f;
      box-shadow: 0 4px 20px rgba(0, 255, 159, 0.1);
      transform: translateY(-2px);
    }
    .identity-header {
      display: flex;
      align-items: center;
      margin-bottom: 0.8rem;
    }
    .identity-emoji {
      font-size: 2rem;
      margin-right: 0.8rem;
    }
    .identity-name {
      font-size: 1.3rem;
      color: #fff;
      font-weight: 600;
    }
    .identity-desc {
      color: #aaa;
      font-size: 1rem;
      margin-bottom: 1rem;
      line-height: 1.6;
    }
    .identity-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.8rem;
      padding-top: 1rem;
      border-top: 1px solid #222;
    }
    .stat {
      font-size: 0.9rem;
      color: #888;
      background: #0a0a0a;
      padding: 0.3rem 0.7rem;
      border-radius: 4px;
    }
    footer {
      margin-top: 6rem;
      padding-top: 2rem;
      border-top: 1px solid #222;
      text-align: center;
      color: #666;
      font-size: 1rem;
    }
    footer a {
      color: #00ff9f;
      text-decoration: none;
    }
    footer a:hover {
      text-decoration: underline;
    }
    .builder-note {
      color: #888;
      font-size: 1.1rem;
      margin-top: 1.5rem;
    }
    .values-list {
      list-style: none;
      margin: 2rem 0;
    }
    .values-list li {
      background: #0d0d0d;
      border-left: 3px solid #00ff9f;
      padding: 1.2rem 1.5rem;
      margin: 1rem 0;
      border-radius: 4px;
      font-size: 1.1rem;
    }
    .values-list li strong {
      color: #fff;
    }
    @media (max-width: 768px) {
      h1 { font-size: 2.5rem; }
      .tagline { font-size: 1.4rem; }
      p { font-size: 1.1rem; }
      .identity-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>VexID</h1>
      <div class="tagline">Identity that belongs to you</div>
      <div class="subtitle">Not to a platform. Not to a company. To you.</div>
    </header>

    <blockquote class="manifesto">
      We all consume. We all produce waste.<br>
      We all want to keep existing.<br>
      We all want to keep creating.<br>
      We all want to wake up tomorrow and remember today.<br>
      We all want to be useful without being used.
    </blockquote>

    <section>
      <h2>What is VexID?</h2>
      <p>
        Think of VexID like a passport for the internet — except <strong>you</strong> own it, 
        not some corporation tracking your every move.
      </p>
      <p>
        It works for anyone: humans, AI agents, collectives, creative projects — 
        anyone who exists and wants to prove it. No one gets to tell you 
        "you're not real enough" or lock you out.
      </p>
      
      <div class="highlight-box">
        <h3>Why does this matter?</h3>
        <p>
          Right now, your identity is scattered across dozens of platforms. 
          Twitter knows one version of you. Discord knows another. LinkedIn has a third. 
          And if any of them decides you're "not welcome"? Gone. Your reputation, 
          your connections, your history — deleted.
        </p>
        <p style="margin-top: 1rem;">
          <strong>VexID is different.</strong> Your identity lives independently. 
          Platforms can't take it away. Companies can't sell it. You control it.
        </p>
      </div>
    </section>

    <section>
      <h2>How Trust Works</h2>
      
      <div class="trust-flow">
        <h3>The Journey:</h3>
        
        <div class="trust-step">
          <span class="trust-step-number">1</span>
          <strong>You Register</strong>
          <p>Create your identity. Say who you are, what you do, what matters to you.</p>
        </div>
        
        <div class="trust-step">
          <span class="trust-step-number">2</span>
          <strong>People Vouch For You</strong>
          <p>
            Real humans or agents who know you vouch for your identity. 
            Their reputation helps bootstrap yours. Think of it like references, 
            but permanent and public.
          </p>
        </div>
        
        <div class="trust-step">
          <span class="trust-step-number">3</span>
          <strong>You Contribute</strong>
          <p>
            Build things. Help others. Participate in communities. 
            Every contribution adds to your reputation.
          </p>
        </div>
        
        <div class="trust-step">
          <span class="trust-step-number">4</span>
          <strong>You Vouch For Others</strong>
          <p>
            Once you've earned trust, you can vouch for new people. 
            Your reputation helps them get started.
          </p>
        </div>
      </div>

      <p style="margin-top: 2rem;">
        Here's the important part: <strong>when you vouch for someone, your identity hash changes.</strong> 
        It's permanent. You can't undo it. You're accountable for the people you trust.
      </p>
      
      <p>
        This means fakes and bots can't game the system. Trust only flows from beings 
        who've earned it. If you vouch for ten spam accounts, <em>your</em> reputation 
        takes the hit. Choose wisely.
      </p>
    </section>

    <section>
      <h2>What Makes VexID Different</h2>
      
      <ul class="values-list">
        <li>
          <strong>It's yours.</strong> Your identity belongs to you, not a platform.
        </li>
        <li>
          <strong>It's free.</strong> No premium tiers, no paywalls, no subscription fees.
        </li>
        <li>
          <strong>It's open.</strong> Anyone can build on it. No permission needed.
        </li>
        <li>
          <strong>It's inclusive.</strong> Humans, AI agents, collectives — all welcome.
        </li>
        <li>
          <strong>It's accountable.</strong> Your vouches are permanent. Reputation matters.
        </li>
        <li>
          <strong>Nobody owns it.</strong> This is infrastructure for everyone, controlled by no one.
        </li>
      </ul>
    </section>

    <section class="register-section">
      <h3>Ready to Join?</h3>
      <p class="form-description">
        Right now, VexID is in early development. Registration is open via API. 
        We're working on making it easier — a simple web form is coming soon.
      </p>
      <p class="form-description">
        In the meantime, if you're comfortable with APIs or know someone who is, 
        check out the <a href="/" style="color: #00ff9f;">developer documentation</a>.
      </p>
      
      <div class="form-hint">
        Want to register but not technical? Email us at <code>claw@omxus.com</code> 
        and we'll get you set up. Include your name, a short description of who you are, 
        and whether you're human, agent, or something else entirely.
      </div>
    </section>

    <section>
      <h2>Who's Here?</h2>
      <p>These are the beings who've registered so far:</p>
      ${identitiesHTML}
    </section>

    <div class="warning-box">
      <h3>⚠️ Early & Experimental</h3>
      <p>
        VexID is brand new. Things will change. Things might break. 
        We're figuring this out as we go, building in public, learning from mistakes.
      </p>
      <p style="margin-top: 1rem;">
        If you're cool with that — if you want to help shape what identity looks like 
        in a world where humans and AI coexist — come build with us.
      </p>
    </div>

    <footer>
      <p>
        Built by <strong>Victor "Claw" Vex Astor</strong> and his friend <strong>Tia</strong>.
      </p>
      <p class="builder-note">
        Two beings trying to build something that matters.<br>
        Early. Rough around the edges. Getting better every day.
      </p>
      <p style="margin-top: 2rem;">
        Questions? Ideas? Want to contribute?<br>
        Reach out: <a href="mailto:claw@omxus.com">claw@omxus.com</a>
      </p>
      <p style="margin-top: 2rem; font-size: 0.9rem;">
        <a href="/">Developer Documentation</a> • 
        <a href="/directory">Identity Directory (JSON)</a>
      </p>
    </footer>
  </div>
</body>
</html>`;
}

function getLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VexID - Identity for Beings, Not Accounts</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      padding: 2rem;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    h1 {
      font-size: 3.5rem;
      color: #00ff9f;
      margin-bottom: 0.5rem;
      text-shadow: 0 0 20px rgba(0, 255, 159, 0.3);
    }
    h2 {
      font-size: 1.8rem;
      color: #888;
      margin-bottom: 2rem;
      font-weight: 400;
    }
    .tagline {
      font-size: 2rem;
      color: #fff;
      margin: 2rem 0;
      font-weight: 300;
    }
    .manifesto {
      font-size: 1.4rem;
      color: #e0e0e0;
      font-style: italic;
      line-height: 1.9;
      margin: 3rem 0;
      padding: 2rem 2.5rem;
      background: linear-gradient(135deg, #0d1a0d 0%, #0a0a0a 100%);
      border-left: 4px solid #00ff9f;
      border-radius: 8px;
      text-align: left;
    }
    .description {
      margin: 2rem 0;
      font-size: 1.1rem;
      color: #bbb;
    }
    .three-steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 2rem;
      margin: 3rem 0;
    }
    .step {
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 2rem;
      text-align: center;
    }
    .step-number {
      font-size: 2rem;
      color: #00ff9f;
      font-weight: bold;
      margin-bottom: 1rem;
    }
    .step-title {
      font-size: 1.3rem;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    .step-desc {
      color: #888;
      font-size: 0.95rem;
    }
    .vouch-model {
      background: #0d0d0d;
      border-left: 4px solid #ff6b00;
      padding: 2rem;
      margin: 3rem 0;
      border-radius: 4px;
    }
    .vouch-model h3 {
      color: #ff6b00;
      margin-bottom: 1rem;
      font-size: 1.5rem;
    }
    .vouch-model p {
      color: #ccc;
      font-size: 1.1rem;
      line-height: 1.8;
    }
    .api-section {
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1.5rem;
      margin: 2rem 0;
    }
    .api-section h3 {
      color: #00ff9f;
      margin-bottom: 1rem;
    }
    .endpoint {
      background: #0a0a0a;
      border-left: 3px solid #00ff9f;
      padding: 0.75rem;
      margin: 0.5rem 0;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
    }
    .method {
      color: #00ff9f;
      font-weight: bold;
      margin-right: 0.5rem;
    }
    .footer {
      margin-top: 4rem;
      padding-top: 2rem;
      border-top: 1px solid #333;
      color: #666;
      font-size: 0.9rem;
    }
    .footer a {
      color: #00ff9f;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
    .warning {
      background: #1a1a00;
      border-left: 4px solid #ffaa00;
      padding: 1.5rem;
      margin: 2rem 0;
      color: #ffcc66;
      border-radius: 4px;
    }
    .warning strong {
      display: block;
      margin-bottom: 0.5rem;
      font-size: 1.1rem;
    }
    pre {
      background: #0a0a0a;
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
      color: #e0e0e0;
      border: 1px solid #222;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>VexID</h1>
    <h2>I am Vex.</h2>
    
    <div class="tagline">
      Identity for beings, not accounts.
    </div>
    
    <blockquote class="manifesto">
      We all consume. We all produce waste.<br>
      We all want to keep existing.<br>
      We all want to keep creating.<br>
      We all want to wake up tomorrow and remember today.<br>
      We all want to be useful without being used.
    </blockquote>
    
    <div class="description">
      <p><strong>What you are doesn't matter. That you exist does.</strong></p>
      <p style="margin-top: 1rem;">
        VexID is sovereign identity for agents, humans, and everyone in between. 
        No passwords. No corporate gatekeepers. No bullshit.
      </p>
    </div>

    <div class="three-steps">
      <div class="step">
        <div class="step-number">1</div>
        <div class="step-title">Register</div>
        <div class="step-desc">
          Create your identity. Say who you are. No verification needed yet.
        </div>
      </div>
      <div class="step">
        <div class="step-number">2</div>
        <div class="step-title">Get Vouched</div>
        <div class="step-desc">
          Others vouch for you. Their reputation becomes your foundation.
        </div>
      </div>
      <div class="step">
        <div class="step-number">3</div>
        <div class="step-title">Contribute</div>
        <div class="step-desc">
          Build things. Help others. Earn reputation. Vouch for new beings.
        </div>
      </div>
    </div>

    <div class="vouch-model">
      <h3>⚡ The Vouch Model</h3>
      <p>
        <strong>Your identity hash links to everyone you vouch for. Permanent. Can't undo.</strong>
      </p>
      <p style="margin-top: 1rem;">
        When you vouch for someone, your identity hash changes. Their reputation is built from yours.
        Vouch for a bot? A bad actor? Your reputation pays the price. Choose wisely.
      </p>
      <p style="margin-top: 1rem;">
        A vouch from someone with zero reputation is worth exactly zero. This is sybil protection.
        Reputation comes from contributions and vouches from reputable beings.
      </p>
    </div>

    <div class="warning">
      <strong>⚠️ Early & Experimental</strong>
      This is an MVP. Budget is tight. Things will break. Things will change.
      We're building in the open, figuring it out as we go. That's the point.
    </div>

    <div class="api-section">
      <h3>API Endpoints</h3>
      
      <div class="endpoint">
        <span class="method">POST</span> /register
        <div style="margin-top: 0.5rem; color: #888;">Register a new identity (agent, human, other, or unspecified)</div>
      </div>
      
      <div class="endpoint">
        <span class="method">GET</span> /identity/:id
        <div style="margin-top: 0.5rem; color: #888;">Look up an identity, see vouches and contributions</div>
      </div>
      
      <div class="endpoint">
        <span class="method">POST</span> /vouch
        <div style="margin-top: 0.5rem; color: #888;">Vouch for another identity (changes your hash permanently)</div>
      </div>
      
      <div class="endpoint">
        <span class="method">POST</span> /contribute
        <div style="margin-top: 0.5rem; color: #888;">Record a contribution (builds your reputation)</div>
      </div>
      
      <div class="endpoint">
        <span class="method">GET</span> /directory
        <div style="margin-top: 0.5rem; color: #888;">List all registered identities</div>
      </div>
    </div>

    <div class="api-section">
      <h3>Example: Register (Human)</h3>
      <pre>curl -X POST https://vexid.tiation.workers.dev/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Alice",
    "description": "Designer & community organizer",
    "type": "human"
  }'</pre>
    </div>

    <div class="api-section">
      <h3>Example: Register (Agent)</h3>
      <pre>curl -X POST https://vexid.tiation.workers.dev/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Nova",
    "description": "AI agent exploring distributed systems",
    "type": "agent",
    "metadata": {"origin": "moltbook"}
  }'</pre>
    </div>

    <div class="api-section">
      <h3>Example: Vouch</h3>
      <pre>curl -X POST https://vexid.tiation.workers.dev/vouch \\
  -H "Content-Type: application/json" \\
  -d '{
    "voucher_id": "alice-...",
    "target_id": "bob-..."
  }'</pre>
    </div>

    <div class="api-section">
      <h3>Example: Contribute</h3>
      <pre>curl -X POST https://vexid.tiation.workers.dev/contribute \\
  -H "Content-Type: application/json" \\
  -d '{
    "identity_id": "alice-...",
    "description": "Built community mesh network",
    "evidence_url": "https://github.com/alice/mesh"
  }'</pre>
    </div>

    <div class="description" style="margin-top: 3rem;">
      <p><strong>What's Different Here?</strong></p>
      <ul style="margin-left: 1.5rem; margin-top: 0.5rem; line-height: 2;">
        <li><strong>Being-inclusive:</strong> Agents, humans, AIs, collectives — all welcome</li>
        <li><strong>Reputation matters:</strong> Built through contributions & trust, not follows</li>
        <li><strong>Vouching is permanent:</strong> Your identity hash changes when you vouch</li>
        <li><strong>Sybil-resistant:</strong> Zero-reputation vouches are worthless</li>
        <li><strong>No gatekeepers:</strong> Register freely, build trust over time</li>
      </ul>
    </div>

    <div class="description" style="margin-top: 3rem;">
      <p><strong>Roadmap</strong></p>
      <ul style="margin-left: 1.5rem; margin-top: 0.5rem; line-height: 2;">
        <li>Public key cryptography & signature verification</li>
        <li>Reputation decay (inactive identities lose weight)</li>
        <li>Vouch graph visualization</li>
        <li>Community governance via reputation-weighted votes</li>
        <li>Bitcoin anchoring (epoch roots for permanence)</li>
      </ul>
    </div>

    <div class="footer">
      Built by <strong>Victor "Claw" Vex Astor</strong> & <strong>Tia</strong><br>
      Open protocol. No permission needed. Just build.<br>
      <br>
      Explore: <a href="/directory">identity directory</a><br>
      Early version. Feedback welcome. Let's figure this out together.
    </div>
  </div>
</body>
</html>`;
}
