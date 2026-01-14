import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Performance logging
async function logModelPerformance(
  serviceClient: any,
  modelName: string,
  status: 'success' | 'error' | 'quota_exceeded',
  responseTimeMs?: number,
  errorMessage?: string
): Promise<void> {
  try {
    await serviceClient.rpc('log_model_performance', {
      p_api_key_id: null,
      p_model_name: modelName,
      p_task_type: 'analyze',
      p_status: status,
      p_response_time_ms: responseTimeMs || null,
      p_error_message: errorMessage?.slice(0, 500) || null,
    });
    console.log(`[PerformanceLog] ${status} for ${modelName} (analyze)`);
  } catch (err) {
    console.warn('[PerformanceLog] Failed to log:', err);
  }
}

// Decrypt user's Gemini API key
async function decryptApiKey(encryptedValue: string, encryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  const combined = Uint8Array.from(atob(encryptedValue), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const encryptedData = combined.slice(12);
  
  const keyData = encoder.encode(encryptionKey);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData.slice(0, 32),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  
  const decryptedData = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encryptedData
  );
  
  return decoder.decode(decryptedData);
}

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string, serviceClient?: any): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    const startTime = Date.now();
    try {
      console.log(`Trying Gemini model: ${model}`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
            },
          }),
        }
      );

      const responseTimeMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini ${model} failed with status ${response.status}`);
        const isQuota = response.status === 429 || errorText.toLowerCase().includes('quota');
        if (serviceClient) {
          await logModelPerformance(serviceClient, model, isQuota ? 'quota_exceeded' : 'error', responseTimeMs, errorText.slice(0, 200));
        }
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        if (serviceClient) {
          await logModelPerformance(serviceClient, model, 'success', responseTimeMs);
        }
        return text;
      }
    } catch (err) {
      const responseTimeMs = Date.now() - startTime;
      console.error(`Error with ${model}:`, err);
      if (serviceClient) {
        await logModelPerformance(serviceClient, model, 'error', responseTimeMs, err instanceof Error ? err.message : String(err));
      }
      continue;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Service client for logging
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Create Supabase client with user auth
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Get authenticated user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's Gemini API key
    const { data: secretData, error: secretError } = await supabaseClient
      .from('user_secrets')
      .select('encrypted_value')
      .eq('user_id', user.id)
      .eq('secret_name', 'GEMINI_API_KEY')
      .single();

    if (secretError || !secretData) {
      return new Response(JSON.stringify({ 
        error: 'Gemini API key not found. Please set it in Settings.',
        code: 'API_KEY_NOT_FOUND'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appEncryptionKey = Deno.env.get('app_encryption_key');
    if (!appEncryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const geminiApiKey = await decryptApiKey(secretData.encrypted_value, appEncryptionKey);

    const { testData } = await req.json();

    // Use service role client to fetch actual test data
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    let detailedTestData = testData;
    
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      // Fetch actual submission data with answers for detailed analysis
      const [readingSubmissions, listeningSubmissions] = await Promise.all([
        supabase
          .from('reading_test_submissions')
          .select('*, reading_tests(title, book_name)')
          .eq('user_id', user.id)
          .order('completed_at', { ascending: false })
          .limit(5),
        supabase
          .from('listening_test_submissions')
          .select('*, listening_tests(title, book_name)')
          .eq('user_id', user.id)
          .order('completed_at', { ascending: false })
          .limit(5)
      ]);
      
      detailedTestData = {
        reading: readingSubmissions.data || [],
        listening: listeningSubmissions.data || [],
        ...testData
      };
    }

    const systemPrompt = `You are an IELTS expert analyst providing detailed, actionable feedback. Analyze the student's test performance data and provide comprehensive insights.

IMPORTANT: Include specific examples from the student's actual performance when available. For instance:
- "In Cambridge 19 Listening Test 1, you wrote 'cup' instead of 'cups' - pay attention to singular/plural forms"
- "You often confuse 'Not Given' with 'False' in True/False/Not Given questions"
- "Your spelling errors cost you 3 marks in the last test (e.g., 'accomodation' instead of 'accommodation')"

Return a JSON object with this exact structure:
{
  "overallBand": number (0-9 scale, with .5 increments),
  "overallTrend": "up" | "down" | "stable",
  "topStrengths": string[] (3 items, be specific with examples),
  "areasToImprove": string[] (3 items, with specific actionable techniques),
  "modules": [
    {
      "module": "reading" | "listening" | "writing" | "speaking",
      "averageScore": number (0-100),
      "totalTests": number,
      "bandScore": number (0-9),
      "trend": "up" | "down" | "stable",
      "weakAreas": string[] (2-3 specific question types),
      "commonMistakes": string[] (2-3 specific patterns with examples like "wrote 'informations' instead of 'information'"),
      "improvements": string[] (2-3 actionable techniques like "Use the '3-step skimming method': 1. Read first/last sentences 2. Identify keywords 3. Match with answer options"),
      "detailedExamples": [
        {
          "testName": string (e.g., "Cambridge 19 Test 1"),
          "mistake": string (specific error),
          "correction": string (what should have been),
          "technique": string (how to avoid this in future)
        }
      ],
      "resources": [{ "title": string, "url": string, "type": "video" | "article" | "practice" }]
    }
  ]
}

Provide REAL, ACTIONABLE resources from reputable IELTS sources like:
- British Council IELTS (https://takeielts.britishcouncil.org/)
- IELTS.org (https://www.ielts.org/)
- Cambridge IELTS (https://www.cambridgeenglish.org/)

Be specific, practical, and encouraging. Focus on patterns that can be improved with targeted practice.`;

    const userPrompt = `Analyze this IELTS test performance data in detail:

${JSON.stringify(detailedTestData, null, 2)}

Provide:
1. Comprehensive analysis with specific examples from the test data
2. Identify recurring patterns in mistakes
3. Give actionable techniques with step-by-step instructions
4. Recommend specific resources for improvement
5. Be encouraging but honest about areas needing work`;

    const content = await callGemini(geminiApiKey, systemPrompt, userPrompt, serviceClient);
    
    if (!content) {
      return new Response(
        JSON.stringify({ analytics: null, error: 'Failed to generate analysis' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Parse JSON from response
    let analytics;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analytics = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      return new Response(
        JSON.stringify({ analytics: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ analytics }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in analyze-performance function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", analytics: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
