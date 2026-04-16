import OpenAI from "openai";

// DeepSeek API client is created lazily to avoid crashing app render on module import.
let deepseekClient: OpenAI | null = null;
let openaiClient: OpenAI | null = null;

function getOpenAIApiKey(): string {
  return process.env.OPENAI_API_KEY || "";
}

function getDeepseekClient(): OpenAI {
  if (deepseekClient) return deepseekClient;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置，请检查 .env.local");
  }

  deepseekClient = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
    dangerouslyAllowBrowser: true,
  });

  return deepseekClient;
}

function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未配置，无法使用真音频直传。");
  }
  openaiClient = new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
  return openaiClient;
}

// 保持与 gemini.ts 相同的接口，确保兼容性
export interface ScenarioResult {
  scenarioName: string;
  subScenarioName: string;
  imageUrl: string;
  situations: {
    title: string;
    description: string;
    imageUrl?: string;
    dialogue: {
      role: string;
      content: string;
    }[];
  }[];
  keyPatterns: {
    pattern: string;
    explanation: string; // Should be in Chinese
    examples: string[];
  }[];
  vocabulary: {
    word: string;
    meaning: string; // Should be in Chinese
    collocation: string;
    pronunciation?: string; // IPA: /əˈbaʊt/
  }[];
  practiceExercise: {
    context: string;
    task: string;
    hints: string[];
    aiCharacter: string;
    aiFirstMessage: string;
  };
}

export interface RoleplayMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EvaluationResult {
  score: number;
  fluency: number;
  grammar: number;
  politeness: number;
  feedback: string; // Should be in Chinese
  improvedSentences: {
    original: string;
    improved: string;
    reason: string; // Should be in Chinese
  }[];
  expandedGuidance: {
    topic: string;
    explanation: string; // Should be in Chinese
    scenarios: {
      context: string;
      phrases: string[];
    }[];
    keyVocab: {
      word: string;
      usage: string;
    }[];
  }[];
}

export interface HistoryInsightResult {
  commonPatterns: {
    pattern: string;
    count: number;
    issue: string;
    naturalAlternative: string;
  }[];
  commonVocabulary: {
    word: string;
    count: number;
    betterChoices: string[];
    note: string;
  }[];
  actionPlan: string[];
}

export interface ExpressionCoachResult {
  coreIntent: string;
  naturalExpression: string;
  alternatives: string[];
  otherScenarios: {
    scenario: string;
    example: string;
  }[];
}

export interface AudioRoleplayResult {
  transcript: string;
  aiResponse: string;
}

export function hasOpenAITranscriptionSupport(): boolean {
  return Boolean(getOpenAIApiKey());
}

// Helper function to clean JSON response
function cleanJsonResponse(text: string): string {
  return text.replace(/```json\n?|```/g, "").trim();
}

function buildScenarioImageUrl(bigScenario: string, subScenario: string): string {
  const seed = encodeURIComponent(`${bigScenario}-${subScenario}`.replace(/\s+/g, "-"));
  return `https://picsum.photos/seed/${seed}/1200/700`;
}

function buildSituationImageUrl(bigScenario: string, subScenario: string, title: string, index: number): string {
  const seed = encodeURIComponent(`${bigScenario}-${subScenario}-${title}-${index}`.replace(/\s+/g, "-"));
  return `https://picsum.photos/seed/${seed}/900/420`;
}

export async function generateScenarioTraining(
  bigScenario: string,
  subScenario: string
): Promise<ScenarioResult> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are an expert English teacher. Generate a comprehensive English training module for a specific sub-scenario within a larger context."
      },
      {
        role: "user",
        content: `Big Scenario: ${bigScenario}
        Sub-Scenario: ${subScenario}

        Requirements:
        1. Keep all dialogue lines in ENGLISH ONLY.
        2. Keep practiceExercise context/task/hints/aiFirstMessage in ENGLISH ONLY.
        3. Explanations and meanings (explanation, meaning) should be in Chinese to help learners.
        4. Provide 2 distinct situations within this sub-scenario.
        5. Provide 4 key sentence patterns with Chinese explanations.
        6. Provide 6-8 essential vocabulary words with Chinese meanings and IPA pronunciation.
        7. Create a specific roleplay task with practical spoken English.
        8. imageUrl can be any placeholder URL string.

        Return the result in the following JSON format:
        {
          "scenarioName": "${bigScenario}",
          "subScenarioName": "${subScenario}",
          "imageUrl": "URL",
          "situations": [
            {
              "title": "Situation Title",
              "description": "Brief context",
              "dialogue": [{"role": "A", "content": "..."}, {"role": "B", "content": "..."}]
            }
          ],
          "keyPatterns": [
            {
              "pattern": "Pattern",
              "explanation": "中文解释",
              "examples": ["Example 1", "Example 2"]
            }
          ],
          "vocabulary": [
            {
              "word": "Word",
              "meaning": "中文意思",
              "collocation": "Common usage",
              "pronunciation": "/word pronunciation in IPA/"
            }
          ],
          "practiceExercise": {
            "context": "Roleplay context",
            "task": "Specific mission for the user",
            "hints": ["Hint 1", "Hint 2"],
            "aiCharacter": "Character Name",
            "aiFirstMessage": "First line from AI"
          }
        }`
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Failed to generate scenario training");
  }

  try {
    const cleanedText = cleanJsonResponse(content);
    const parsed = JSON.parse(cleanedText) as ScenarioResult;
    return {
      ...parsed,
      imageUrl: buildScenarioImageUrl(bigScenario, subScenario),
      situations: (parsed.situations || []).map((s, i) => ({
        ...s,
        imageUrl: buildSituationImageUrl(bigScenario, subScenario, s.title || `scene-${i + 1}`, i + 1),
      })),
    };
  } catch (err) {
    console.error("JSON Parse Error (Scenario):", err, content);
    throw new Error("AI 返回的数据格式不正确，请稍后重试。");
  }
}

export async function generateNewTask(
  bigScenario: string,
  subScenario: string,
  previousTask: string
): Promise<{ task: string; hints: string[]; aiFirstMessage: string }> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "Generate a NEW, different roleplay task for the same sub-scenario."
      },
      {
        role: "user",
        content: `Big Scenario: ${bigScenario}
        Sub-Scenario: ${subScenario}
        Previous Task: ${previousTask}

        The new task should be more challenging or cover a different aspect of the same setting.
        IMPORTANT: task, hints and aiFirstMessage must be in natural spoken ENGLISH.

        Return in JSON:
        {
          "task": "New mission description",
          "hints": ["Hint 1", "Hint 2"],
          "aiFirstMessage": "AI's opening line"
        }`
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content || "{}";

  try {
    const cleanedText = cleanJsonResponse(content);
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("JSON Parse Error (NewTask):", err, content);
    return { task: "Continue the roleplay with a new objective.", hints: [], aiFirstMessage: "Great, let's continue." };
  }
}

export async function suggestSubScenarios(input: string): Promise<string[]> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "Given a broad English learning scenario, suggest 10 specific, practical sub-scenarios or tasks."
      },
      {
        role: "user",
        content: `Input: ${input}

        Return as a simple JSON array of exactly 10 ENGLISH strings: ["Sub 1", "Sub 2", ...]`
      }
    ]
  });

  const content = response.choices[0]?.message?.content || "[]";

  try {
    const cleanedText = cleanJsonResponse(content);
    const parsed = JSON.parse(cleanedText);

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }

    const list = (parsed?.subScenarios || parsed?.suggestions || parsed?.items) as unknown;
    if (Array.isArray(list)) {
      return list.filter((item): item is string => typeof item === "string");
    }

    return [
      "Basic conversation",
      "Problem solving in context",
      "Clarifying details",
      "Making polite requests",
      "Responding to mistakes",
      "Negotiating options",
      "Giving feedback",
      "Asking for help",
      "Handling unexpected changes",
      "Closing the conversation"
    ];
  } catch (err) {
    console.error("JSON Parse Error (SubScenarios):", err, content);
    return [
      "Basic conversation",
      "Problem solving in context",
      "Clarifying details",
      "Making polite requests",
      "Responding to mistakes",
      "Negotiating options",
      "Giving feedback",
      "Asking for help",
      "Handling unexpected changes",
      "Closing the conversation"
    ];
  }
}

export async function getRoleplayResponse(
  scenario: string,
  aiCharacter: string,
  history: RoleplayMessage[]
): Promise<string> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: `You are playing a character in a roleplay scenario for English learning.
        Scenario: ${scenario}
        Your Character: ${aiCharacter}

        Guidelines:
        - ALWAYS reply in English.
        - Keep responses concise (1-3 sentences).
        - Use natural, idiomatic spoken English.
        - React realistically to the user's input.
        - If the user makes a mistake, don't correct them yet, just keep the conversation going.`
      },
      ...history.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content
      }))
    ]
  });

  return response.choices[0]?.message?.content || "I'm sorry, I couldn't respond. Could you say that again?";
}

export async function evaluateRoleplay(
  scenario: string,
  history: RoleplayMessage[]
): Promise<EvaluationResult> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "Analyze the following English roleplay conversation and provide a detailed evaluation for the user."
      },
      {
        role: "user",
        content: `Scenario: ${scenario}
        Conversation:
        ${history.map(m => `${m.role}: ${m.content}`).join("\n")}

        Requirements:
        1. The "feedback" and "reason" fields MUST be in Chinese.
        2. The "expandedGuidance" explanation MUST be in Chinese.
        3. improved and all phrases/vocab examples should be in natural ENGLISH.
        4. expandedGuidance must be actionable for the learner: focus on what the USER should say in this scenario.
        5. In each expandedGuidance.scenarios.phrases, provide practical sentence patterns the user can directly use.
        6. In each keyVocab.usage, include collocation plus a short example sentence.
        7. Provide 5-7 improvedSentences so learners get enough correction examples.
        8. Keep expandedGuidance concise: at most 2 topics.

        Return the evaluation in the following JSON format:
        {
          "score": 0-100,
          "fluency": 0-100,
          "grammar": 0-100,
          "politeness": 0-100,
          "feedback": "总体评价（中文）",
          "improvedSentences": [
            {
              "original": "The user's sentence",
              "improved": "A more natural/correct version",
              "reason": "改进原因（中文）"
            }
          ],
          "expandedGuidance": [
            {
              "topic": "Topic Name",
              "explanation": "详细讲解（中文）",
              "scenarios": [
                {
                  "context": "Different context for this pattern",
                  "phrases": ["Phrase 1", "Phrase 2"]
                }
              ],
              "keyVocab": [
                {
                  "word": "Word",
                  "usage": "Usage explanation"
                }
              ]
            }
          ]
        }`
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Failed to evaluate roleplay");
  }

  try {
    const cleanedText = cleanJsonResponse(content);
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("JSON Parse Error (Evaluation):", err, content);
    throw new Error("评估报告生成失败，请稍后重试。");
  }
}

export async function translateToSpokenEnglish(input: string): Promise<string> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "Translate the user's Chinese sentence into natural, concise spoken English for roleplay. Return only one English sentence."
      },
      {
        role: "user",
        content: input
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || input;
}

export async function polishEnglishForRoleplay(input: string): Promise<string> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "Polish the user's English into a natural spoken sentence for roleplay. Keep the original intent. Return only the polished English sentence."
      },
      {
        role: "user",
        content: input
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || input;
}

export async function translateAssistantMessageToChinese(input: string): Promise<string> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "Translate the English dialogue line into natural Chinese for learners. Keep tone and intent. Return Chinese only."
      },
      {
        role: "user",
        content: input
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || "翻译失败，请重试。";
}

export async function analyzeHistoryInsights(history: RoleplayMessage[]): Promise<HistoryInsightResult> {
  if (!history.length) {
    return { commonPatterns: [], commonVocabulary: [], actionPlan: [] };
  }

  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are an English speaking coach. Analyze learner conversation history and produce concise actionable coaching JSON."
      },
      {
        role: "user",
        content: `Conversation history:
${history.map((m) => `${m.role}: ${m.content}`).join("\n")}

Requirements:
1. Focus on user speaking habits and repeated expressions.
2. Return 4-6 commonPatterns with count, issue(中文), naturalAlternative(英文).
3. Return 5-8 commonVocabulary with count, betterChoices(英文数组), note(中文).
4. actionPlan provide 4-6 short Chinese bullet-style suggestions.

Return JSON:
{
  "commonPatterns":[{"pattern":"...","count":0,"issue":"...","naturalAlternative":"..."}],
  "commonVocabulary":[{"word":"...","count":0,"betterChoices":["..."],"note":"..."}],
  "actionPlan":["..."]
}`
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content || "{}";
  try {
    const cleaned = cleanJsonResponse(content);
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("JSON Parse Error (HistoryInsight):", err, content);
    return { commonPatterns: [], commonVocabulary: [], actionPlan: ["暂时无法生成历史分析，请稍后重试。"] };
  }
}

export async function getExpressionCoach(input: string): Promise<ExpressionCoachResult> {
  const response = await getDeepseekClient().chat.completions.create({
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are a concise speaking assistant. Convert the learner intent into natural English and provide reusable alternatives."
      },
      {
        role: "user",
        content: `Learner intent: ${input}

Return JSON:
{
  "coreIntent":"中文概括用户想表达的意思",
  "naturalExpression":"最地道的一句英文表达",
  "alternatives":["替代表达1","替代表达2","替代表达3"],
  "otherScenarios":[
    {"scenario":"可复用场景1","example":"该场景可用英文例句"},
    {"scenario":"可复用场景2","example":"该场景可用英文例句"}
  ]
}`
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content || "{}";
  try {
    const cleaned = cleanJsonResponse(content);
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("JSON Parse Error (ExpressionCoach):", err, content);
    return {
      coreIntent: "暂时无法识别",
      naturalExpression: input,
      alternatives: [],
      otherScenarios: []
    };
  }
}

export async function transcribeAudioToText(
  audioBase64: string,
  mimeType = "audio/webm"
): Promise<string> {
  const client = getOpenAIClient();
  const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "webm";
  const audioFile = new File([binary], `voice.${extension}`, { type: mimeType });

  const transcription = await client.audio.transcriptions.create({
    file: audioFile,
    model: "gpt-4o-mini-transcribe",
    language: "zh",
  });

  const transcript = transcription.text?.trim();
  if (!transcript) {
    throw new Error("语音识别失败，请重试。");
  }

  return transcript;
}

export async function getRoleplayResponseFromAudio(
  audioBase64: string,
  scenario: string,
  aiCharacter: string,
  history: RoleplayMessage[]
): Promise<AudioRoleplayResult> {
  const client = getOpenAIClient();
  const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const audioFile = new File([binary], "voice.webm", { type: "audio/webm" });

  const transcription = await client.audio.transcriptions.create({
    file: audioFile,
    model: "gpt-4o-mini-transcribe",
    language: "zh",
  });

  const transcript = transcription.text?.trim();
  if (!transcript) {
    throw new Error("语音识别失败，请重试。");
  }

  const aiResponse = await getRoleplayResponse(scenario, aiCharacter, [...history, { role: "user", content: transcript }]);
  return { transcript, aiResponse };
}
