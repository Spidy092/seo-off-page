const { GoogleGenAI } = require('@google/genai');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { createLogger } = require('../utils/logger');

const log = createLogger('service:ai-analyzer');

// Initialize clients (they will be null if keys are missing from .env)
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const nvidia = process.env.NVIDIA_API_KEY
    ? new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: 'https://integrate.api.nvidia.com/v1' })
    : null;
const sarvam = process.env.SARVAM_API_KEY
    ? new OpenAI({ apiKey: process.env.SARVAM_API_KEY, baseURL: 'https://api.sarvam.ai/v1' })
    : null;

/**
 * AI Content Analysis Service
 * Cascades through available free-tier AI APIs to score the context of a backlink and write a hook.
 *
 * @param {string} contextText - The 50-100 word anchor text context extracted from the page
 * @param {string} targetDomain - The user's domain we want a backlink for
 * @returns {Promise<Object>} - Structured JSON with analysis
 */
async function analyzeWithAI(contextText, targetDomain) {
    const prompt = `
You are an expert SEO outreach specialist. Analyze the following webpage text snippet (the "anchor context"). 
It contains a link to one or more of our competitors. Our domain is ${targetDomain}.

Text snippet:
"${contextText}"

Analyze this text and return a strict JSON object with EXACTLY the following format:
{
  "isRelevant": true, // boolean: Does this text context genuinely relate to our industry/niche?
  "topicSimilarityScore": 85, // integer 1-100: How closely the context matches our niche.
  "linkIntent": "listicle", // string: Why did they link? e.g., "resource_page", "listicle", "editorial_mention", "spam", "directory"
  "outreachHook": "I noticed you mentioned [competitor] on your resource page, we are another leading provider of..." // string: A personalized 1-sentence hook for an email asking them to add our domain to this same page.
}

Return ONLY the valid JSON object. Do not include markdown formatting like \`\`\`json.
`;

    // 1. Try Gemini (Primary - Generous Free Tier)
    if (gemini) {
        try {
            const response = await gemini.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                }
            });
            const text = response.text;
            return JSON.parse(text);
        } catch (err) {
            log.warn({ err: err.message }, 'Gemini AI failed, falling back to Groq');
        }
    }

    // 2. Try Groq (Fallback 1 - Fast Free Tier)
    if (groq) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama3-8b-8192',
                response_format: { type: 'json_object' }
            });
            return JSON.parse(completion.choices[0].message.content);
        } catch (err) {
            log.warn({ err: err.message }, 'Groq AI failed, falling back to Nvidia NIM');
        }
    }

    // 3. Try Nvidia NIM (Fallback 2 - Good Free Tier)
    if (nvidia) {
        try {
            // Using Meta Llama 3 70B Instruct via Nvidia
            const completion = await nvidia.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'meta/llama3-70b-instruct',
                response_format: { type: 'json_object' }
            });
            return JSON.parse(completion.choices[0].message.content);
        } catch (err) {
            log.warn({ err: err.message }, 'Nvidia AI failed, falling back to Sarvam AI');
        }
    }

    // 4. Try Sarvam AI (Fallback 3 - Indic/English API)
    if (sarvam) {
        try {
            const completion = await sarvam.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'sarvam-1', // Defaulting to sarvam-1
                // Not all OpenAI endpoints support response_format strict json yet, so we omit and trust the prompt
            });
            const textContent = completion.choices[0].message.content;

            // Clean up potentially dirty markdown from local/alternative models
            const cleaned = textContent.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch (err) {
            log.error({ err: err.message }, 'Sarvam AI failed. All AI providers exhausted.');
        }
    }

    // If no AI is configured or all fail, return a safe neutral fallback
    log.warn('No AI providers succeeded. Returning neutral fallback analysis.');
    return {
        isRelevant: true,
        topicSimilarityScore: 50,
        linkIntent: "unknown",
        outreachHook: "I saw you linked to similar companies and would love to be considered as well."
    };
}

module.exports = { analyzeWithAI };
