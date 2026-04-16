import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ScenarioResult {
  scenarioName: string;
  subScenarioName: string;
  imageUrl: string;
  situations: {
    title: string;
    description: string;
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

export async function generateScenarioTraining(
  bigScenario: string, 
  subScenario: string
): Promise<ScenarioResult> {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        text: `You are an expert English teacher. Generate a comprehensive English training module for a specific sub-scenario within a larger context.
        
        Big Scenario: ${bigScenario}
        Sub-Scenario: ${subScenario}
        
        Requirements:
        1. All explanations (explanation, meaning, feedback, reason) MUST be in Chinese.
        2. Provide 3 distinct situations within this sub-scenario.
        3. Provide 5 key sentence patterns with Chinese explanations.
        4. Provide 8-10 essential vocabulary words with Chinese meanings.
        5. Create a specific practice exercise (roleplay) with a clear task.
        6. Provide a relevant image URL from Unsplash or Picsum that represents the scenario (e.g., https://picsum.photos/seed/${subScenario.replace(/\s+/g, '')}/800/400).
        
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
              "collocation": "Common usage"
            }
          ],
          "practiceExercise": {
            "context": "Roleplay context",
            "task": "Specific mission for the user",
            "hints": ["Hint 1", "Hint 2"],
            "aiCharacter": "Character Name",
            "aiFirstMessage": "First line from AI"
          }
        }
        `
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scenarioName: { type: Type.STRING },
          subScenarioName: { type: Type.STRING },
          imageUrl: { type: Type.STRING },
          situations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                dialogue: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      role: { type: Type.STRING },
                      content: { type: Type.STRING }
                    }
                  }
                }
              }
            }
          },
          keyPatterns: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                pattern: { type: Type.STRING },
                explanation: { type: Type.STRING },
                examples: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            }
          },
          vocabulary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                meaning: { type: Type.STRING },
                collocation: { type: Type.STRING }
              }
            }
          },
          practiceExercise: {
            type: Type.OBJECT,
            properties: {
              context: { type: Type.STRING },
              task: { type: Type.STRING },
              hints: { type: Type.ARRAY, items: { type: Type.STRING } },
              aiCharacter: { type: Type.STRING },
              aiFirstMessage: { type: Type.STRING }
            }
          }
        },
        required: ["scenarioName", "subScenarioName", "imageUrl", "situations", "keyPatterns", "vocabulary", "practiceExercise"]
      }
    }
  });

  if (!response.text) {
    throw new Error("Failed to generate scenario training");
  }

  try {
    // Clean potential markdown code blocks from response
    const cleanedText = response.text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("JSON Parse Error (Scenario):", err, response.text);
    throw new Error("AI 返回的数据格式不正确，请稍后重试。");
  }
}

export async function generateNewTask(
  bigScenario: string,
  subScenario: string,
  previousTask: string
): Promise<{ task: string; hints: string[]; aiFirstMessage: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        text: `Generate a NEW, different roleplay task for the same sub-scenario.
        
        Big Scenario: ${bigScenario}
        Sub-Scenario: ${subScenario}
        Previous Task: ${previousTask}
        
        The new task should be more challenging or cover a different aspect of the same setting.
        
        Return in JSON:
        {
          "task": "New mission description",
          "hints": ["Hint 1", "Hint 2"],
          "aiFirstMessage": "AI's opening line"
        }
        `
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          task: { type: Type.STRING },
          hints: { type: Type.ARRAY, items: { type: Type.STRING } },
          aiFirstMessage: { type: Type.STRING }
        },
        required: ["task", "hints", "aiFirstMessage"]
      }
    }
  });

  try {
    const cleanedText = (response.text || "{}").replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("JSON Parse Error (NewTask):", err, response.text);
    return { task: "继续对话", hints: [], aiFirstMessage: "好的，我们继续。" };
  }
}

export async function suggestSubScenarios(input: string): Promise<string[]> {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        text: `Given a broad English learning scenario, suggest 5-6 specific, practical sub-scenarios or tasks.
        
        Input: ${input}
        
        Return as a simple JSON array of strings: ["Sub 1", "Sub 2", ...]
        `
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });

  try {
    const cleanedText = (response.text || "[]").replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("JSON Parse Error (SubScenarios):", err, response.text);
    return ["基础对话", "进阶练习"];
  }
}

export async function getRoleplayResponse(
  scenario: string,
  aiCharacter: string,
  history: RoleplayMessage[]
): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [{
          text: `You are playing a character in a roleplay scenario for English learning.
        Scenario: ${scenario}
        Your Character: ${aiCharacter}
        
        Guidelines:
        - Keep responses concise (1-3 sentences).
        - Use natural, idiomatic spoken English.
        - React realistically to the user's input.
        - If the user makes a mistake, don't correct them yet, just keep the conversation going.
        `
        }]
      },
      ...history.map(m => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }]
      }))
    ]
  });

  return response.text || "I'm sorry, I couldn't respond. Could you say that again?";
}

export async function evaluateRoleplay(
  scenario: string,
  history: RoleplayMessage[]
): Promise<EvaluationResult> {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        text: `Analyze the following English roleplay conversation and provide a detailed evaluation for the user.
        
        Scenario: ${scenario}
        Conversation:
        ${history.map(m => `${m.role}: ${m.content}`).join("\n")}

        Requirements:
        1. The "feedback" and "reason" fields MUST be in Chinese.
        2. The "expandedGuidance" explanation MUST be in Chinese.
        3. Provide detailed coaching on sentence patterns and vocabulary.

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
        }
        `
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          fluency: { type: Type.NUMBER },
          grammar: { type: Type.NUMBER },
          politeness: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          improvedSentences: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                original: { type: Type.STRING },
                improved: { type: Type.STRING },
                reason: { type: Type.STRING }
              },
              required: ["original", "improved", "reason"]
            }
          },
          expandedGuidance: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                explanation: { type: Type.STRING },
                scenarios: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      context: { type: Type.STRING },
                      phrases: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                  }
                },
                keyVocab: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      word: { type: Type.STRING },
                      usage: { type: Type.STRING }
                    }
                  }
                }
              },
              required: ["topic", "explanation", "scenarios", "keyVocab"]
            }
          }
        },
        required: ["score", "fluency", "grammar", "politeness", "feedback", "improvedSentences", "expandedGuidance"]
      }
    }
  });

  if (!response.text) {
    throw new Error("Failed to evaluate roleplay");
  }

  try {
    const cleanedText = response.text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("JSON Parse Error (Evaluation):", err, response.text);
    throw new Error("评估报告生成失败，请稍后重试。");
  }
}
