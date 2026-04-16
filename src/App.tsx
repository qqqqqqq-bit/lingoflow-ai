/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, 
  RefreshCw,
  Search,
  MessageSquare,
  Target,
  Lightbulb,
  Send,
  Trophy,
  CheckCircle2,
  ArrowRight,
  History,
  LayoutGrid,
  ChevronLeft,
  Calendar,
  Trash2
} from "lucide-react";
import { 
  generateScenarioTraining, 
  getRoleplayResponse, 
  evaluateRoleplay,
  suggestSubScenarios,
  generateNewTask,
  translateAssistantMessageToChinese,
  analyzeHistoryInsights,
  getExpressionCoach,
  getRoleplayResponseFromAudio,
  hasOpenAITranscriptionSupport,
  ScenarioResult, 
  RoleplayMessage, 
  EvaluationResult,
  HistoryInsightResult,
  ExpressionCoachResult,
  transcribeAudioToText
} from "./services/deepseek";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SavedSession {
  id: string;
  date: string;
  scenarioName: string;
  score: number;
  history: RoleplayMessage[];
  evaluation: EvaluationResult;
}

interface PhraseUsageRecord {
  phrase: string;
  normalizedPhrase: string;
  scenarioKey: string;
  scenarioName: string;
  subScenarioName: string;
  date: string;
}

interface AssistantTranslationRecord {
  index: number;
  text: string;
}

interface InlineTranslationRecord {
  key: string;
  text: string;
}

const BIG_SCENARIOS = [
  { 
    title: "餐厅用餐", 
    icon: "🍽️", 
    desc: "从预定到结账，掌握地道餐饮英语",
    subScenarios: ["预定座位", "点餐与询问菜品", "处理订单错误", "催促上菜", "结账与小费", "投诉服务"]
  },
  { 
    title: "机场与飞行", 
    icon: "✈️", 
    desc: "值机、安检、登机及机上交流",
    subScenarios: ["办理值机", "安检询问", "寻找登机口", "机上点餐", "海关入境", "行李丢失处理"]
  },
  { 
    title: "购物中心", 
    icon: "🛍️", 
    desc: "挑选商品、试穿、砍价及退换货",
    subScenarios: ["寻找特定商品", "试穿与尺码咨询", "询问折扣", "收银台结账", "办理退货", "寻找丢失物品"]
  },
  { 
    title: "酒店住宿", 
    icon: "🏨", 
    desc: "入住、客房服务及退房流程",
    subScenarios: ["办理入住", "客房服务请求", "设施咨询", "投诉房间问题", "办理退房", "寄存行李"]
  },
  { 
    title: "职场办公", 
    icon: "💼", 
    desc: "会议、面试、日常沟通与汇报",
    subScenarios: ["面试自我介绍", "参加团队会议", "向老板汇报进度", "与同事协作", "处理客户投诉", "申请休假"]
  },
  { 
    title: "日常社交", 
    icon: "🤝", 
    desc: "破冰、聚会、结交新朋友",
    subScenarios: ["初次见面自我介绍", "讨论天气与爱好", "邀请朋友聚会", "在派对上闲聊", "表达感谢与赞美", "礼貌地拒绝邀请"]
  },
  {
    title: "电影与追剧",
    icon: "🎬",
    desc: "聊剧情、角色、反转和彩蛋，练习观点表达",
    subScenarios: ["推荐一部电影", "讨论角色塑造", "评价剧情节奏", "分享最喜欢的片段", "吐槽烂尾", "讨论续集期待"]
  },
  {
    title: "游戏开黑",
    icon: "🎮",
    desc: "组队沟通、战术协作与赛后复盘",
    subScenarios: ["邀请好友组队", "分配游戏角色", "实时战术沟通", "鼓励队友", "赛后复盘", "礼貌应对失误"]
  },
  {
    title: "音乐节与演唱会",
    icon: "🎵",
    desc: "购票、现场交流、分享音乐偏好",
    subScenarios: ["询问演出信息", "讨论歌手与曲风", "现场找座位", "购买周边", "分享观后感", "计划下次演出"]
  },
];

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionLike = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type MediaRecorderWithEvents = MediaRecorder & {
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: (() => void) | null;
};

function getSpeechRecognitionCtor() {
  return (
    (window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
    (window as typeof window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
  );
}

function isSpeechRecognitionSupported() {
  return Boolean(getSpeechRecognitionCtor());
}

function normalizeSentence(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function countPhraseUsage(records: PhraseUsageRecord[], sentence: string): number {
  const normalized = normalizeSentence(sentence);
  if (!normalized) return 0;
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  if (!tokens.size) return 0;
  return records.filter((r) => {
    const oldTokens = new Set(r.normalizedPhrase.split(" ").filter(Boolean));
    let overlap = 0;
    tokens.forEach((t) => {
      if (oldTokens.has(t)) overlap += 1;
    });
    return overlap / Math.max(Math.min(tokens.size, oldTokens.size), 1) >= 0.6;
  }).length;
}

export default function App() {
  const [view, setView] = useState<"home" | "training" | "roleplay" | "history">("home");
  const [scenarioInput, setScenarioInput] = useState("");
  const [selectedBigScenario, setSelectedBigScenario] = useState<typeof BIG_SCENARIOS[0] | null>(null);
  const [suggestedSubScenarios, setSuggestedSubScenarios] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [featuredScenarios, setFeaturedScenarios] = useState<typeof BIG_SCENARIOS>([]);

  // Roleplay State
  const [chatHistory, setChatHistory] = useState<RoleplayMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGeneratingNextTask, setIsGeneratingNextTask] = useState(false);
  const [translatedAssistantItems, setTranslatedAssistantItems] = useState<AssistantTranslationRecord[]>([]);
  const [inlineTranslations, setInlineTranslations] = useState<InlineTranslationRecord[]>([]);
  const [translatingMsgIndex, setTranslatingMsgIndex] = useState<number | null>(null);
  const [translatingInlineKey, setTranslatingInlineKey] = useState<string | null>(null);
  const [isGeneratingCoach, setIsGeneratingCoach] = useState(false);
  const [expressionCoach, setExpressionCoach] = useState<ExpressionCoachResult | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceSending, setIsVoiceSending] = useState(false);
  const [audioWaveTick, setAudioWaveTick] = useState(0);
  const [voiceHoldStartY, setVoiceHoldStartY] = useState<number | null>(null);
  const [isVoiceCanceling, setIsVoiceCanceling] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isTtsReady, setIsTtsReady] = useState(false);
  const voiceCanceledRef = useRef(false);

  // History State
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<SavedSession | null>(null);
  const [phraseMemory, setPhraseMemory] = useState<PhraseUsageRecord[]>([]);
  const [historyInsight, setHistoryInsight] = useState<HistoryInsightResult | null>(null);
  const [isAnalyzingHistory, setIsAnalyzingHistory] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const lastSpokenAssistantRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorderWithEvents | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceInputRecorderRef = useRef<MediaRecorderWithEvents | null>(null);
  const voiceInputChunksRef = useRef<Blob[]>([]);
  const voiceInputStreamRef = useRef<MediaStream | null>(null);
  const holdSpeechTranscriptRef = useRef("");
  const holdSpeechShouldSendRef = useRef(false);

  useEffect(() => {
    const history = localStorage.getItem("lingoflow_history");
    if (history) {
      setSavedSessions(JSON.parse(history));
    }
    const phraseHistory = localStorage.getItem("lingoflow_phrase_memory");
    if (phraseHistory) {
      setPhraseMemory(JSON.parse(phraseHistory));
    }
    // Randomize featured scenarios on load
    setFeaturedScenarios([...BIG_SCENARIOS].sort(() => 0.5 - Math.random()).slice(0, 3));
    // Preload voices for browser TTS so the UI can reflect whether replay is available.
    ensureVoicesLoaded()
      .then((ready) => setIsTtsReady(ready))
      .catch(err => {
        console.error("Failed to preload voices:", err);
        setIsTtsReady(false);
      });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isAiTyping]);

  useEffect(() => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#f0f4f8";
    return () => {
      document.body.style.backgroundColor = previous;
    };
  }, []);

  useEffect(() => {
    if (!autoSpeak || !isTtsReady || view !== "roleplay" || chatHistory.length === 0) return;
    const last = chatHistory[chatHistory.length - 1];
    if (last.role !== "assistant") return;
    if (last.content === lastSpokenAssistantRef.current) return;

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      const utterance = new SpeechSynthesisUtterance(last.content);
      utterance.lang = "en-US";
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
      lastSpokenAssistantRef.current = last.content;
    }
  }, [chatHistory, autoSpeak, isTtsReady, view]);

  useEffect(() => {
    if (view !== "roleplay") return;
    const content = userInput.trim();
    if (!content) {
      setExpressionCoach(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsGeneratingCoach(true);
      try {
        const coach = await getExpressionCoach(content);
        setExpressionCoach(coach);
      } catch (err) {
        console.error(err);
      } finally {
        setIsGeneratingCoach(false);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [userInput, view]);

  const saveSession = (evalResult: EvaluationResult) => {
    if (!result) return;
    const newSession: SavedSession = {
      id: Date.now().toString(),
      date: new Date().toLocaleString(),
      scenarioName: `${result.scenarioName} - ${result.subScenarioName}`,
      score: evalResult.score,
      history: chatHistory,
      evaluation: evalResult
    };
    const updated = [newSession, ...savedSessions];
    setSavedSessions(updated);
    localStorage.setItem("lingoflow_history", JSON.stringify(updated));
  };

  const deleteSession = (id: string) => {
    const updated = savedSessions.filter(s => s.id !== id);
    setSavedSessions(updated);
    localStorage.setItem("lingoflow_history", JSON.stringify(updated));
    if (selectedHistory?.id === id) setSelectedHistory(null);
  };

  const handleBigScenarioClick = async (big: typeof BIG_SCENARIOS[0]) => {
    setSelectedBigScenario(big);
    setSuggestedSubScenarios(big.subScenarios);
  };

  const handleSearch = async () => {
    if (!scenarioInput.trim()) return;
    setIsLoading(true);
    try {
      const subs = await suggestSubScenarios(scenarioInput);
      setSuggestedSubScenarios(subs);
      setSelectedBigScenario({ title: scenarioInput, icon: "🔍", desc: "自定义搜索场景", subScenarios: subs });
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async (big: string, sub: string) => {
    setIsLoading(true);
    setError(null);
    setProgress(10);
    setView("training");

    try {
      const interval = setInterval(() => {
        setProgress((prev) => (prev < 90 ? prev + 5 : prev));
      }, 400);

      const training = await generateScenarioTraining(big, sub);
      clearInterval(interval);
      setProgress(100);
      setResult(training);
    } catch (err) {
      setError("AI 生成失败，请尝试更具体的场景描述。");
      console.error(err);
      setView("home");
    } finally {
      setIsLoading(false);
    }
  };

  const startRoleplay = () => {
    if (!result) return;
    setChatHistory([{ role: "assistant", content: result.practiceExercise.aiFirstMessage }]);
    setTranslatedAssistantItems([]);
    setInlineTranslations([]);
    setExpressionCoach(null);
    setView("roleplay");
    setEvaluation(null);
  };

  const sendPreparedMessage = async (finalUserInput: string) => {
    if (!result || isAiTyping) return;
    const newHistory: RoleplayMessage[] = [...chatHistory, { role: "user", content: finalUserInput }];
    setChatHistory(newHistory);
    setUserInput("");
    setTimeout(autoResizeInput, 0);
    setIsAiTyping(true);
    setExpressionCoach(null);

    const scenarioKey = `${result.scenarioName}__${result.subScenarioName}`;
    const record: PhraseUsageRecord = {
      phrase: finalUserInput,
      normalizedPhrase: normalizeSentence(finalUserInput),
      scenarioKey,
      scenarioName: result.scenarioName,
      subScenarioName: result.subScenarioName,
      date: new Date().toLocaleString(),
    };
    const updatedPhraseMemory = [record, ...phraseMemory].slice(0, 300);
    setPhraseMemory(updatedPhraseMemory);
    localStorage.setItem("lingoflow_phrase_memory", JSON.stringify(updatedPhraseMemory));

    try {
      const aiResponse = await getRoleplayResponse(
        `${result.scenarioName} - ${result.subScenarioName}`, 
        result.practiceExercise.aiCharacter, 
        newHistory
      );
      setChatHistory([...newHistory, { role: "assistant", content: aiResponse }]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAiTyping(false);
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim() || !result || isAiTyping) return;
    await sendPreparedMessage(userInput.trim());
  };

  const stopMediaStream = (stream?: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const content = String(reader.result || "");
        const encoded = content.split(",")[1];
        if (encoded) {
          resolve(encoded);
        } else {
          reject(new Error("音频编码失败"));
        }
      };
      reader.onerror = () => reject(reader.error || new Error("音频读取失败"));
      reader.readAsDataURL(blob);
    });

  const getEnglishVoice = (roleHint?: string): SpeechSynthesisVoice | null => {
    if (!("speechSynthesis" in window)) {
      console.warn("Speech synthesis not available");
      return null;
    }
    try {
      const allVoices = window.speechSynthesis.getVoices();
      let voices = allVoices.filter((v) => v.lang.toLowerCase().startsWith("en"));
      if (!voices.length) {
        voices = allVoices;
      }
      if (!voices.length) {
        console.warn("No voices available");
        return null;
      }
      if (roleHint && voices.length > 1) {
        const selected = roleHint.toUpperCase().includes("A") ? voices[0] : voices[1];
        console.log("Selected voice for role:", selected.name);
        return selected;
      }
      console.log("Selected default voice:", voices[0].name);
      return voices[0];
    } catch (err) {
      console.error("Error getting voice:", err);
      return null;
    }
  };

  const ensureVoicesLoaded = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        console.warn("Speech synthesis not available");
        resolve(false);
        return;
      }
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        console.log("✓ Voices already available:", voices.length);
        setIsTtsReady(true);
        resolve(true);
        return;
      }
      console.log("⏳ Waiting for voices to load...");
      let resolved = false;
      const onVoicesChanged = () => {
        if (!resolved) {
          resolved = true;
          const loaded = window.speechSynthesis.getVoices();
          console.log("✓ Voices loaded:", loaded.length);
          window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
          const ready = window.speechSynthesis.getVoices().length > 0;
          setIsTtsReady(ready);
          resolve(ready);
        }
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log("⏱️ Voice loading timeout (1s), proceeding");
          window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
          const ready = window.speechSynthesis.getVoices().length > 0;
          setIsTtsReady(ready);
          resolve(ready);
        }
      }, 4000);
    });
  };

  const speakText = (text: string) => {
    if (!("speechSynthesis" in window)) {
      console.error("Speech synthesis not supported");
      setIsTtsReady(false);
      setError("浏览器不支持语音合成");
      return;
    }
    console.log("🔊 TTS start:", text.substring(0, 40));
    ensureVoicesLoaded().then(() => {
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 0.9;
        utterance.volume = 1;
        utterance.pitch = 1;
        const voice = getEnglishVoice();
        if (voice) {
          utterance.voice = voice;
          console.log("🔊 Voice:", voice.name);
        }
        utterance.onerror = (event) => {
          console.error("🔊 TTS error:", (event as any).error);
          setError(`语音播放失败: ${(event as any).error}`);
        };
        utterance.onend = () => console.log("🔊 TTS done");
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.error("🔊 TTS error:", err);
        setError(String(err));
      }
    }).catch((err) => {
      console.error("🔊 Voice load error:", err);
      setError("语音初始化失败");
    });
  };

  const speakTextWithRole = (text: string, roleHint: string) => {
    if (!("speechSynthesis" in window)) {
      console.error("Speech synthesis not supported");
      setIsTtsReady(false);
      setError("浏览器不支持语音合成");
      return;
    }
    console.log("🔊 TTS role:", roleHint, text.substring(0, 40));
    ensureVoicesLoaded().then(() => {
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 0.9;
        utterance.volume = 1;
        utterance.pitch = 1;
        const voice = getEnglishVoice(roleHint);
        if (voice) {
          utterance.voice = voice;
          console.log("🔊 Voice for role:", voice.name);
        }
        utterance.onerror = (event) => {
          console.error("🔊 TTS error:", (event as any).error);
          setError(`语音播放失败: ${(event as any).error}`);
        };
        utterance.onend = () => console.log("🔊 TTS done");
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.error("🔊 TTS error:", err);
        setError(String(err));
      }
    }).catch((err) => {
      console.error("🔊 Voice load error:", err);
      setError("语音初始化失败");
    });
  };

  const playSituationDialogue = async (dialogue: { role: string; content: string }[]) => {
    if (!("speechSynthesis" in window)) return;
    await ensureVoicesLoaded();
    window.speechSynthesis.cancel();
    for (const line of dialogue) {
      await new Promise<void>((resolve) => {
        try {
          const utterance = new SpeechSynthesisUtterance(line.content);
          utterance.lang = "en-US";
          utterance.rate = 0.9;
          utterance.volume = 1;
          utterance.pitch = 1;
          const voice = getEnglishVoice(line.role);
          if (voice) utterance.voice = voice;
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.error("Error in situation dialogue:", err);
          resolve();
        }
      });
    }
  };

  const playTextAudio = (text: string, roleHint?: string) => {
    if (!("speechSynthesis" in window)) {
      setError("浏览器不支持语音合成");
      return;
    }

    ensureVoicesLoaded()
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            try {
              const synth = window.speechSynthesis;
              synth.cancel();
              synth.resume();

              const utterance = new SpeechSynthesisUtterance(text);
              utterance.lang = "en-US";
              utterance.rate = 0.9;
              utterance.volume = 1;
              utterance.pitch = 1;

              const voice = getEnglishVoice(roleHint);
              if (voice) utterance.voice = voice;

              const timer = window.setTimeout(() => {
                synth.cancel();
                reject(new Error("语音播放超时"));
              }, Math.max(6000, text.length * 180));

              utterance.onend = () => {
                window.clearTimeout(timer);
                resolve();
              };
              utterance.onerror = (event) => {
                window.clearTimeout(timer);
                reject(new Error((event as SpeechSynthesisErrorEvent).error || "unknown"));
              };

              synth.speak(utterance);
            } catch (err) {
              reject(err);
            }
          })
      )
      .then(() => setError(null))
      .catch((err) => {
        console.error("🔊 TTS error:", err);
        setError(`语音播放失败: ${err instanceof Error ? err.message : String(err)}`);
      });
  };

  const playDialogueAudio = async (dialogue: { role: string; content: string }[]) => {
    try {
      for (const line of dialogue) {
        await new Promise<void>((resolve, reject) => {
          if (!("speechSynthesis" in window)) {
            reject(new Error("浏览器不支持语音合成"));
            return;
          }

          ensureVoicesLoaded()
            .then(() => {
              const synth = window.speechSynthesis;
              synth.cancel();
              synth.resume();

              const utterance = new SpeechSynthesisUtterance(line.content);
              utterance.lang = "en-US";
              utterance.rate = 0.9;
              utterance.volume = 1;
              utterance.pitch = 1;

              const voice = getEnglishVoice(line.role);
              if (voice) utterance.voice = voice;

              const timer = window.setTimeout(() => {
                synth.cancel();
                reject(new Error("自动对话播放超时"));
              }, Math.max(6000, line.content.length * 180));

              utterance.onend = () => {
                window.clearTimeout(timer);
                resolve();
              };
              utterance.onerror = (event) => {
                window.clearTimeout(timer);
                reject(new Error((event as SpeechSynthesisErrorEvent).error || "unknown"));
              };

              synth.speak(utterance);
            })
            .catch(reject);
        });
      }
      setError(null);
    } catch (err) {
      console.error("Auto dialogue error:", err);
      setError(`自动对话播放失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleReplayAssistantVoice = (text: string) => {
    if (!isTtsReady) {
      setError("当前浏览器环境没有可用语音引擎，请改用 Chrome/Edge 正常窗口打开。");
      return;
    }
    playTextAudio(text);
  };

  const handleTranslateAssistantMessage = async (index: number, text: string) => {
    setTranslatingMsgIndex(index);
    try {
      const translated = await translateAssistantMessageToChinese(text);
      setTranslatedAssistantItems((prev) => {
        const filtered = prev.filter((item) => item.index !== index);
        return [...filtered, { index, text: translated }];
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTranslatingMsgIndex(null);
    }
  };

  const handleTranslateInlineLine = async (key: string, text: string) => {
    setTranslatingInlineKey(key);
    try {
      const translated = await translateAssistantMessageToChinese(text);
      setInlineTranslations((prev) => {
        const filtered = prev.filter((item) => item.key !== key);
        return [...filtered, { key, text: translated }];
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTranslatingInlineKey(null);
    }
  };

  const toggleVoiceInput = () => {
    const SpeechRecognitionCtor =
      (window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as typeof window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      console.error("Speech Recognition API not available");
      setError("浏览器不支持语音识别，需要 Chrome/Edge 99+ 或其他支持 Web Speech API 的浏览器");
      return;
    }

    if (isListening) {
      console.log("🎤 Stopping recognition");
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    setError(null);
    console.log("🎤 Starting STT recognition...");
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      console.log("🎤 Result received, results count:", event.results.length);
      let hasTranscript = false;
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i]?.[0]?.transcript || "";
        console.log(`🎤 Result[${i}]: "${transcript}"`);
        if (transcript) {
          console.log("🎤 Adding to input:", transcript);
          setUserInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
          hasTranscript = true;
        }
      }
      if (hasTranscript) setTimeout(autoResizeInput, 0);
      recognition.stop();
    };
    
    // @ts-ignore - onerror signature mismatch
    recognition.onerror = (event: any) => {
      const error = event.error || "unknown";
      const msg = error === "no-speech" 
        ? "没有检测到语音，请稍停顿后重试" 
        : error === "permission-denied" 
        ? "麦克风权限被拒绝，请检查浏览器设置"
        : error === "network"
        ? "网络连接失败"
        : error;
      console.error("🎤 STT error:", error);
      setError(`语音识别失败: ${msg}`);
      setIsListening(false);
    };
    
    recognition.onend = () => {
      console.log("🎤 Recognition ended");
      setIsListening(false);
    };

    try {
      console.log("🎤 Calling recognition.start()");
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch (err) {
      console.error("🎤 Failed to start:", err);
      setError(`无法启动语音识别: ${String(err)}`);
      setIsListening(false);
    }
  };

  const startVoiceRecording = async () => {
    if (!result || isAiTyping || isVoiceSending) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("当前浏览器不支持录音功能，请使用 Chrome 或 Edge。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (typeof MediaRecorder === "undefined") {
        setError("当前浏览器不支持录音，请升级浏览器后重试。");
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream) as MediaRecorderWithEvents;
      mediaChunksRef.current = [];
      mediaStreamRef.current = stream;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        console.log("🎙️ Recording stopped, processing...");
        const canceled = voiceCanceledRef.current;
        stream.getTracks().forEach((t) => t.stop());
        if (canceled) {
          console.log("🎙️ Recording canceled by user");
          mediaChunksRef.current = [];
          voiceCanceledRef.current = false;
          setIsVoiceSending(false);
          return;
        }
        try {
          const blob = new Blob(mediaChunksRef.current, { type: "audio/webm" });
          console.log("🎙️ Audio blob size:", blob.size, "chunks:", mediaChunksRef.current.length);
          if (!blob.size) {
            setIsVoiceSending(false);
            setError("录音为空，请确保麦克风已获得权限并且能正常工作");
            return;
          }
          if (!result) {
            setIsVoiceSending(false);
            setError("场景信息丢失，请重新开始");
            return;
          }
          console.log("🎙️ Starting audio encoding...");
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const content = String(reader.result || "");
              const encoded = content.split(",")[1];
              if (encoded) {
                console.log("🎙️ Audio encoded, length:", encoded.length);
                resolve(encoded);
              } else {
                reject(new Error("音频编码失败"));
              }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const scenario = `${result.scenarioName} - ${result.subScenarioName}`;
          console.log("🎙️ Sending to AI, scenario:", scenario);
          setIsAiTyping(true);
          setIsVoiceSending(false);
          try {
            console.log("🎙️ Calling getRoleplayResponseFromAudio...");
            const response = await getRoleplayResponseFromAudio(base64, scenario, result.practiceExercise.aiCharacter, chatHistory);
            console.log("🎙️ Got response:", response);
            const newHistory: RoleplayMessage[] = [...chatHistory, { role: "user", content: response.transcript }, { role: "assistant", content: response.aiResponse }];
            setChatHistory(newHistory);
            setError(null);
          } catch (err) {
            console.error("🎙️ API error:", err);
            const errStr = String(err);
            const msg = errStr.includes("API") || errStr.includes("key") 
              ? "API密钥错误，请检查 OPENAI_API_KEY"
              : errStr.includes("401")
              ? "API密钥无效或过期"
              : errStr.includes("429")
              ? "API 配额已用尽"
              : errStr.includes("network")
              ? "网络连接失败"
              : errStr;
            setError(`AI处理失败: ${msg}`);
          } finally {
            setIsAiTyping(false);
          }
        } catch (err) {
          console.error("🎙️ Recording processing error:", err);
          setIsVoiceSending(false);
          setError(`音频处理失败: ${String(err)}`);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsVoiceSending(true);
      setError(null);
      setAudioWaveTick((v) => v + 1);
    } catch (err) {
      console.error(err);
      setError("无法访问麦克风，请检查浏览器权限。");
      setIsVoiceSending(false);
    }
  };

  const stopVoiceRecording = (cancel = false) => {
    if (cancel) {
      voiceCanceledRef.current = true;
      setIsVoiceCanceling(true);
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleVoiceButtonStart = async (startY: number) => {
    setVoiceHoldStartY(startY);
    setIsVoiceCanceling(false);
    voiceCanceledRef.current = false;
    await startVoiceRecording();
  };

  const handleVoiceButtonMove = (currentY: number) => {
    if (!isVoiceSending || voiceHoldStartY === null) return;
    const deltaY = currentY - voiceHoldStartY;
    setIsVoiceCanceling(deltaY < -40);
  };

  const handleVoiceButtonEnd = () => {
    const shouldCancel = isVoiceCanceling;
    stopVoiceRecording(shouldCancel);
    setVoiceHoldStartY(null);
    setIsVoiceCanceling(false);
  };

  const transcribeBlobWithCloud = async (blob: Blob) => {
    const mimeType = blob.type || "audio/webm";
    const base64 = await blobToBase64(blob);
    return transcribeAudioToText(base64, mimeType);
  };

  const stopVoiceInputRecording = () => {
    if (voiceInputRecorderRef.current && voiceInputRecorderRef.current.state !== "inactive") {
      voiceInputRecorderRef.current.stop();
    }
  };

  const toggleVoiceInputV2 = async () => {
    if (hasOpenAITranscriptionSupport()) {
      if (isListening) {
        stopVoiceInputRecording();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setError("当前浏览器不支持录音转文字，请使用 Chrome 或 Edge。");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream) as MediaRecorderWithEvents;
        voiceInputChunksRef.current = [];
        voiceInputStreamRef.current = stream;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) voiceInputChunksRef.current.push(event.data);
        };

        recorder.onstop = async () => {
          setIsListening(false);
          stopMediaStream(stream);
          const blob = new Blob(voiceInputChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          voiceInputChunksRef.current = [];

          if (!blob.size) {
            setError("没有录到声音，请靠近麦克风后重试。");
            return;
          }

          try {
            const transcript = await transcribeBlobWithCloud(blob);
            setUserInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
            setError(null);
            setTimeout(autoResizeInput, 0);
          } catch (err) {
            console.error("Cloud transcription failed:", err);
            setError(`转文字失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        };

        recorder.start();
        voiceInputRecorderRef.current = recorder;
        setIsListening(true);
        setError(null);
      } catch (err) {
        console.error(err);
        setIsListening(false);
        setError("无法访问麦克风，请检查浏览器权限。");
      }
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      setError("未配置 OPENAI_API_KEY，且浏览器也不支持语音识别。请补充 OPENAI_API_KEY，或使用 Chrome/Edge。");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i]?.[0]?.transcript || "";
      }
      transcript = transcript.trim();
      if (transcript) {
        setUserInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setTimeout(autoResizeInput, 0);
        setError(null);
      }
      recognition.stop();
    };
    recognition.onerror = (event: any) => {
      const errorMessage = event?.error === "no-speech" ? "没有识别到语音" : event?.error || "unknown";
      setError(`转文字失败: ${errorMessage}`);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);

    try {
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      setError(null);
    } catch (err) {
      console.error(err);
      setIsListening(false);
      setError(`无法启动语音识别: ${String(err)}`);
    }
  };

  const handleVoiceButtonStartV2 = async (startY: number) => {
    if (!result || isAiTyping || isVoiceSending) return;

    setVoiceHoldStartY(startY);
    setIsVoiceCanceling(false);
    voiceCanceledRef.current = false;
    holdSpeechTranscriptRef.current = "";
    holdSpeechShouldSendRef.current = false;

    if (hasOpenAITranscriptionSupport()) {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setError("当前浏览器不支持录音发送，请使用 Chrome 或 Edge。");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream) as MediaRecorderWithEvents;
        mediaChunksRef.current = [];
        mediaStreamRef.current = stream;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) mediaChunksRef.current.push(event.data);
        };

        recorder.onstop = async () => {
          const canceled = voiceCanceledRef.current;
          stopMediaStream(stream);
          const recordedChunks = [...mediaChunksRef.current];
          mediaChunksRef.current = [];
          setIsVoiceSending(false);

          if (canceled) {
            voiceCanceledRef.current = false;
            return;
          }

          const blob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
          if (!blob.size || !result) {
            setError("录音为空，请重试。");
            return;
          }

          try {
            const transcript = await transcribeBlobWithCloud(blob);
            if (!transcript.trim()) {
              setError("没有识别到有效语音。");
              return;
            }
            await sendPreparedMessage(transcript.trim());
            setError(null);
          } catch (err) {
            console.error("Voice send failed:", err);
            setError(`语音发送失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsVoiceSending(true);
        setError(null);
        setAudioWaveTick((v) => v + 1);
      } catch (err) {
        console.error(err);
        setError("无法访问麦克风，请检查浏览器权限。");
        setIsVoiceSending(false);
      }
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      setError("未配置 OPENAI_API_KEY，且浏览器不支持按住说话识别。");
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "zh-CN";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i]?.[0]?.transcript || "";
        }
        holdSpeechTranscriptRef.current = transcript.trim();
      };
      recognition.onerror = (event: any) => {
        setError(`按住说话识别失败: ${event?.error || "unknown"}`);
        setIsVoiceSending(false);
      };
      recognition.onend = async () => {
        setIsVoiceSending(false);
        if (holdSpeechShouldSendRef.current && holdSpeechTranscriptRef.current.trim()) {
          try {
            await sendPreparedMessage(holdSpeechTranscriptRef.current.trim());
            setError(null);
          } catch (err) {
            console.error("Hold-to-talk send failed:", err);
            setError(`语音发送失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (holdSpeechShouldSendRef.current && !voiceCanceledRef.current) {
          setError("没有识别到有效语音。");
        }
        holdSpeechShouldSendRef.current = false;
      };
      recognitionRef.current = recognition;
      recognition.start();
      setIsVoiceSending(true);
      setError(null);
      setAudioWaveTick((v) => v + 1);
    } catch (err) {
      console.error(err);
      setIsVoiceSending(false);
      setError(`无法启动按住说话: ${String(err)}`);
    }
  };

  const handleVoiceButtonMoveV2 = (currentY: number) => {
    if (!isVoiceSending || voiceHoldStartY === null) return;
    const deltaY = currentY - voiceHoldStartY;
    setIsVoiceCanceling(deltaY < -40);
  };

  const handleVoiceButtonEndV2 = () => {
    const shouldCancel = isVoiceCanceling;
    voiceCanceledRef.current = shouldCancel;
    setVoiceHoldStartY(null);
    setIsVoiceCanceling(false);

    if (hasOpenAITranscriptionSupport()) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      } else {
        setIsVoiceSending(false);
      }
      return;
    }

    holdSpeechShouldSendRef.current = !shouldCancel;
    recognitionRef.current?.stop();
  };

  const autoResizeInput = () => {
    if (!inputRef.current) return;
    inputRef.current.style.height = "0px";
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
  };

  const finishRoleplay = async () => {
    if (!result || chatHistory.length < 3) {
      setView("training");
      return;
    }

    setIsEvaluating(true);
    try {
      const evalResult = await evaluateRoleplay(`${result.scenarioName} - ${result.subScenarioName}`, chatHistory);
      setEvaluation(evalResult);
      saveSession(evalResult);
    } catch (err) {
      console.error(err);
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleAnalyzeHistory = async () => {
    const allHistory = savedSessions.flatMap((s) => s.history);
    if (!allHistory.length) return;
    setIsAnalyzingHistory(true);
    try {
      const insight = await analyzeHistoryInsights(allHistory);
      setHistoryInsight(insight);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalyzingHistory(false);
    }
  };

  const handleNextTask = async () => {
    if (!result) return;
    setIsGeneratingNextTask(true);
    try {
      const newTask = await generateNewTask(result.scenarioName, result.subScenarioName, result.practiceExercise.task);
      setResult({
        ...result,
        practiceExercise: {
          ...result.practiceExercise,
          task: newTask.task,
          hints: newTask.hints,
          aiFirstMessage: newTask.aiFirstMessage
        }
      });
      setEvaluation(null);
      setChatHistory([{ role: "assistant", content: newTask.aiFirstMessage }]);
      setTranslatedAssistantItems([]);
      setInlineTranslations([]);
      setView("roleplay");
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingNextTask(false);
    }
  };

  const reset = () => {
    setScenarioInput("");
    setSelectedBigScenario(null);
    setSuggestedSubScenarios([]);
    setResult(null);
    setError(null);
    setProgress(0);
    setView("home");
    setChatHistory([]);
    setEvaluation(null);
    setExpressionCoach(null);
    setTranslatedAssistantItems([]);
    setInlineTranslations([]);
    setHistoryInsight(null);
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    voiceInputRecorderRef.current?.stop();
    stopMediaStream(mediaStreamRef.current);
    stopMediaStream(voiceInputStreamRef.current);
    setIsListening(false);
    setIsVoiceSending(false);
    window.speechSynthesis?.cancel();
    setFeaturedScenarios([...BIG_SCENARIOS].sort(() => 0.5 - Math.random()).slice(0, 3));
  };

  const currentPhraseUsageCount = userInput.trim() ? countPhraseUsage(phraseMemory, userInput.trim()) : 0;
  const currentScenarioKey = result ? `${result.scenarioName}__${result.subScenarioName}` : "";
  const currentTokens = new Set(normalizeSentence(userInput).split(" ").filter(Boolean));
  const sameSceneUsage = userInput.trim()
    ? phraseMemory.find(
        (record) => {
          if (record.scenarioKey !== currentScenarioKey) return false;
          const oldTokens = new Set(record.normalizedPhrase.split(" ").filter(Boolean));
          let overlap = 0;
          currentTokens.forEach((t) => {
            if (oldTokens.has(t)) overlap += 1;
          });
          return overlap / Math.max(Math.min(currentTokens.size, oldTokens.size), 1) >= 0.6;
        }
      )
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 text-slate-800 font-sans text-[17px] selection:bg-blue-200 selection:text-slate-900">
      {/* Navigation Rail / Top Bar */}
      <nav className="sticky top-0 z-40 w-full bg-white/85 backdrop-blur-xl border-b border-slate-200 px-6 h-16 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
          <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight text-slate-900">LingoFlow AI</span>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant={view === "home" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={reset}
            className="rounded-full px-4 text-slate-700 hover:text-slate-900"
          >
            <LayoutGrid className="w-4 h-4 mr-2" /> 场景库
          </Button>
          <Button 
            variant={view === "history" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setView("history")}
            className="rounded-full px-4 text-slate-700 hover:text-slate-900"
          >
            <History className="w-4 h-4 mr-2" /> 练习历史
          </Button>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 md:p-12">
        <AnimatePresence mode="wait">
          {view === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
              {!selectedBigScenario ? (
                <>
                  <div className="text-center space-y-4">
                    <h2 className="text-5xl font-black tracking-tight bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 bg-clip-text text-transparent">今天想聊点什么？</h2>
                    <p className="text-slate-600 max-w-xl mx-auto font-semibold text-lg">选择一个大类场景，或者输入你自己的想法，开始沉浸式英语练习。</p>
                  </div>

                  {/* Search / Custom Input */}
                  <div className="max-w-2xl mx-auto relative group">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                    <input
                      value={scenarioInput}
                      onChange={(e) => setScenarioInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      placeholder="输入任何你想练习的场景（如：面试、租房）..."
                      className="w-full h-16 bg-white border border-slate-300 rounded-2xl pl-14 pr-32 text-lg text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 transition-all shadow-sm"
                    />
                    <Button 
                      onClick={handleSearch}
                      disabled={!scenarioInput.trim() || isLoading}
                      className="absolute right-2 top-2 bottom-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-6"
                    >
                      {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "搜索场景"}
                    </Button>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-lg font-bold text-slate-800 uppercase tracking-widest">✨ 推荐大类</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {featuredScenarios.map((s) => (
                        <Card 
                          key={s.title} 
                          className="group hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/5 transition-all cursor-pointer border-slate-300 bg-white"
                          onClick={() => handleBigScenarioClick(s)}
                        >
                          <CardHeader className="pb-2">
                            <div className="text-3xl mb-2">{s.icon}</div>
                            <CardTitle className="text-lg font-bold group-hover:text-blue-600 transition-colors">{s.title}</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-base text-slate-700 leading-relaxed">{s.desc}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <div className="flex justify-center">
                      <Button variant="outline" onClick={() => setFeaturedScenarios([...BIG_SCENARIOS].sort(() => 0.5 - Math.random()).slice(0, 3))} className="text-slate-700 border-slate-300 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 font-semibold">
                        <RefreshCw className="w-4 h-4 mr-2" /> 换一批场景
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-8"
                >
                  <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => setSelectedBigScenario(null)} className="rounded-full">
                      <ChevronLeft className="w-6 h-6" />
                    </Button>
                    <div>
                      <h2 className="text-3xl font-black text-slate-900 flex items-center gap-3">
                        <span className="text-4xl">{selectedBigScenario.icon}</span>
                        {selectedBigScenario.title}
                      </h2>
                      <p className="text-slate-600 font-semibold">{selectedBigScenario.desc}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {suggestedSubScenarios.map((sub, i) => (
                      <Card 
                        key={i} 
                        className="group hover:bg-blue-50 hover:border-blue-200 transition-all cursor-pointer border-slate-200 bg-white p-6"
                        onClick={() => handleGenerate(selectedBigScenario.title, sub)}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-700 group-hover:text-blue-700">{sub}</span>
                          <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                        </div>
                      </Card>
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {view === "training" && (
            <motion.div
              key="training"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              {isLoading ? (
                <div className="max-w-md mx-auto text-center space-y-6 py-20">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                    <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold">正在为您构建场景...</h3>
                    <p className="text-slate-500 text-sm">AI 正在准备地道的对话和实用句式</p>
                  </div>
                  <Progress value={progress} className="h-1.5 bg-slate-100" />
                </div>
              ) : result && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    <div className="flex items-center gap-4">
                      <Button variant="ghost" size="icon" onClick={reset} className="rounded-full">
                        <ChevronLeft className="w-6 h-6" />
                      </Button>
                      <div>
                        <h2 className="text-3xl font-black text-slate-900">{result.subScenarioName}</h2>
                        <p className="text-slate-500 text-sm font-semibold">{result.scenarioName}</p>
                      </div>
                    </div>

                    {result.imageUrl && (
                      <div className="w-full h-48 rounded-2xl overflow-hidden shadow-sm border border-slate-200">
                        <img 
                          src={result.imageUrl} 
                          alt={result.subScenarioName} 
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = "https://picsum.photos/seed/lingoflow-main/1200/700";
                          }}
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    <Tabs defaultValue="dialogue" className="w-full">
                      <TabsList className="bg-slate-200 p-1 rounded-xl mb-6">
                        <TabsTrigger value="dialogue" className="rounded-lg px-6 text-slate-700 data-[state=active]:bg-black data-[state=active]:text-white">参考对话</TabsTrigger>
                        <TabsTrigger value="patterns" className="rounded-lg px-6 text-slate-700 data-[state=active]:bg-black data-[state=active]:text-white">核心句式</TabsTrigger>
                        <TabsTrigger value="vocab" className="rounded-lg px-6 text-slate-700 data-[state=active]:bg-black data-[state=active]:text-white">重点词汇</TabsTrigger>
                      </TabsList>

                      <TabsContent value="dialogue" className="space-y-6">
                        {result.situations.map((sit, i) => (
                          <Card key={i} className="border-slate-300 overflow-hidden bg-slate-50 shadow-sm">
                            {sit.imageUrl && (
                              <div className="w-full h-36 overflow-hidden border-b border-slate-100">
                                <img
                                  src={sit.imageUrl}
                                  alt={sit.title}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.src = `https://picsum.photos/seed/lingoflow-sit-${i + 1}/900/420`;
                                  }}
                                  referrerPolicy="no-referrer"
                                />
                              </div>
                            )}
                            <CardHeader className="bg-slate-100 border-b border-slate-200">
                              <CardTitle className="text-base font-bold flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-white text-slate-700 border-slate-300">情况 {i + 1}</Badge>
                                {sit.title}
                                </span>
                                <button
                                  type="button"
                                  className="h-7 px-2 rounded-md bg-black text-white text-[11px]"
                                  onClick={() => playDialogueAudio(sit.dialogue)}
                                >
                                  自动对话
                                </button>
                              </CardTitle>
                              <CardDescription className="text-slate-700">{sit.description}</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6">
                              <div className="space-y-4">
                                {sit.dialogue.map((line, j) => (
                                  <div key={j} className="flex gap-4 items-start">
                                    <span className="text-[10px] font-bold text-blue-600 uppercase w-16 shrink-0 mt-1">{line.role}:</span>
                                    <div className="flex-1">
                                      <p className="text-base text-slate-800 leading-relaxed">{line.content}</p>
                                      {inlineTranslations.find((item) => item.key === `sample-${i}-${j}`)?.text && (
                                        <p className="mt-1 text-sm text-slate-600 bg-white border border-slate-200 rounded px-2 py-1">
                                          中译：{inlineTranslations.find((item) => item.key === `sample-${i}-${j}`)?.text}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        className="h-6 px-2 rounded-md bg-black text-white text-[11px]"
                                        onClick={() => playTextAudio(line.content, line.role)}
                                      >
                                        发音
                                      </button>
                                      <button
                                        type="button"
                                        className="h-6 px-2 rounded-md bg-black text-white text-[11px]"
                                        onClick={() => handleTranslateInlineLine(`sample-${i}-${j}`, line.content)}
                                      >
                                        {translatingInlineKey === `sample-${i}-${j}` ? "..." : "翻译"}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </TabsContent>

                    <TabsContent value="patterns" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {result.keyPatterns.map((kp, i) => (
                          <Card key={i} className="border-slate-300 bg-slate-50 shadow-sm">
                            <CardContent className="p-6 space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 text-blue-600 font-bold">{kp.pattern}</div>
                                <button
                                  type="button"
                                  className="h-6 px-2 rounded-md bg-black text-white text-[10px] whitespace-nowrap shrink-0"
                                  onClick={() => playTextAudio(kp.pattern)}
                                  title="Click to hear pronunciation"
                                >
                                  🔊
                                </button>
                              </div>
                              <p className="text-xs text-slate-700 bg-white p-2 rounded-lg border border-slate-200">{kp.explanation}</p>
                              <div className="space-y-1 pt-2">
                                {kp.examples.map((ex, j) => (
                                  <div key={j} className="text-[11px] text-slate-800 flex items-start gap-2 italic">
                                    <div className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                                    <span className="flex-1">{ex}</span>
                                    <button
                                      type="button"
                                      className="h-5 px-1.5 rounded text-[8px] bg-slate-200 hover:bg-slate-300 text-slate-700 shrink-0 whitespace-nowrap"
                                      onClick={() => playTextAudio(ex)}
                                    >
                                      读
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </TabsContent>

                    <TabsContent value="vocab" className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {result.vocabulary.map((v, i) => (
                          <div key={i} className="p-4 bg-slate-50 border border-slate-300 rounded-xl shadow-sm space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="font-bold text-slate-900">{v.word}</div>
                                {v.pronunciation && (
                                  <div className="text-xs text-blue-600 italic">{v.pronunciation}</div>
                                )}
                              </div>
                              <button
                                type="button"
                                className="h-6 px-2 rounded-md bg-black text-white text-[10px] whitespace-nowrap shrink-0"
                                onClick={() => playTextAudio(v.word)}
                                title="Click to hear pronunciation"
                              >
                                🔊
                              </button>
                            </div>
                            <div className="text-xs text-blue-700">{v.meaning}</div>
                            <div className="text-[10px] text-slate-600 italic">{v.collocation}</div>
                          </div>
                        ))}
                      </TabsContent>
                    </Tabs>
                  </div>

                  <div className="space-y-6">
                    <Card className="bg-blue-600 text-white border-none shadow-xl shadow-blue-600/20 sticky top-24">
                      <CardHeader>
                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-2">
                          <Target className="w-6 h-6 text-white" />
                        </div>
                        <CardTitle className="text-xl font-bold">准备好实战了吗？</CardTitle>
                        <CardDescription className="text-white/90">
                          AI 将扮演 <span className="font-bold underline">{result.practiceExercise.aiCharacter}</span> 与您进行实时对话。
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="p-4 bg-white/15 rounded-xl border border-white/20">
                          <h4 className="text-xs font-bold uppercase tracking-widest mb-2 opacity-70">任务目标</h4>
                          <p className="text-sm leading-relaxed text-white">{result.practiceExercise.task}</p>
                        </div>
                        <Button 
                          onClick={startRoleplay}
                          className="w-full h-14 bg-white text-blue-600 hover:bg-blue-50 font-bold rounded-xl shadow-lg"
                        >
                          开始 AI 对练
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === "roleplay" && (
            <motion.div
              key="roleplay"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-6xl mx-auto min-h-[calc(100vh-12rem)] flex flex-col gap-6 overflow-auto"
            >
              {!evaluation ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
                  <div className="lg:col-span-8 flex flex-col gap-4 h-full min-h-0">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <MessageSquare className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <h2 className="font-bold text-slate-900">正在与 {result?.practiceExercise.aiCharacter} 对话</h2>
                          <p className="text-xs text-slate-500">{result?.subScenarioName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={autoSpeak ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => setAutoSpeak((prev) => !prev)}
                          className="text-slate-500"
                          disabled={!isTtsReady}
                        >
                          {autoSpeak ? "语音播报开" : "语音播报关"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setView("training")} className="text-slate-500">
                          退出对练
                        </Button>
                      </div>
                    </div>

                    <Card className="flex-grow min-h-0 bg-white border-slate-200 overflow-hidden flex flex-col shadow-sm">
                      {result?.imageUrl && (
                        <div className="w-full h-32 shrink-0 overflow-hidden border-b border-slate-100">
                          <img
                            src={result.imageUrl}
                            alt="Scenario"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.src = "https://picsum.photos/seed/lingoflow-roleplay/1200/700";
                            }}
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                      <ScrollArea className="flex-grow min-h-0 p-6">
                        <div className="space-y-6">
                          {chatHistory.map((msg, i) => {
                            const translated = translatedAssistantItems.find((item) => item.index === i)?.text;
                            return (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                              >
                                <div className="flex items-start gap-2 max-w-[90%]">
                                  <div className={`p-4 rounded-2xl text-base leading-relaxed ${
                                    msg.role === "user"
                                      ? "bg-blue-600 text-white rounded-tr-none"
                                      : "bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200"
                                  }`}>
                                    <p>{msg.content}</p>
                                    {msg.role === "assistant" && translated && (
                                      <p className="mt-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1">
                                        中译：{translated}
                                      </p>
                                    )}
                                  </div>
                                  {msg.role === "assistant" && (
                                    <div className="flex flex-col gap-1 shrink-0">
                                      <button
                                        type="button"
                                        className="h-6 px-2 rounded-md bg-black text-white text-[11px] disabled:bg-slate-300 disabled:text-slate-500"
                                        onClick={() => handleReplayAssistantVoice(msg.content)}
                                        disabled={!isTtsReady}
                                        title={isTtsReady ? "播放发音" : "当前浏览器环境不支持发音"}
                                      >
                                        发音
                                      </button>
                                      <button
                                        type="button"
                                        className="h-6 px-2 rounded-md bg-black text-white text-[11px]"
                                        onClick={() => handleTranslateAssistantMessage(i, msg.content)}
                                      >
                                        {translatingMsgIndex === i ? "..." : "翻译"}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            );
                          })}
                          {isAiTyping && (
                            <div className="flex justify-start">
                              <div className="bg-slate-100 p-4 rounded-2xl rounded-tl-none flex gap-1">
                                <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                              </div>
                            </div>
                          )}
                          <div ref={chatEndRef} />
                        </div>
                      </ScrollArea>
                    </Card>

                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4">
                      <textarea
                        ref={inputRef}
                        value={userInput}
                        rows={1}
                        onInput={autoResizeInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder="输入你想说的话（中英都可），回车发送，Shift+Enter 换行..."
                        className="w-full min-h-[56px] max-h-[200px] pr-28 py-4 bg-white border border-slate-300 rounded-2xl px-4 text-[17px] leading-relaxed focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all resize-none overflow-y-auto"
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                          type="button"
                          onClick={toggleVoiceInputV2}
                          className={`h-10 px-3 rounded-2xl text-sm ${isListening ? "bg-black text-white" : "bg-slate-200 text-slate-800"}`}
                        >
                          转文字
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            handleVoiceButtonStartV2(e.clientY);
                          }}
                          onPointerMove={(e) => handleVoiceButtonMoveV2(e.clientY)}
                          onPointerUp={(e) => {
                            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                            handleVoiceButtonEndV2();
                          }}
                          onPointerCancel={(e) => {
                            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                            handleVoiceButtonEndV2();
                          }}
                          className={`h-10 px-3 rounded-2xl text-sm ${isVoiceSending ? (isVoiceCanceling ? "bg-rose-500 text-white" : "bg-black text-white") : "bg-slate-200 text-slate-800"}`}
                        >
                          {isVoiceSending ? (isVoiceCanceling ? "松开取消" : "松开发送") : "按住说话"}
                        </button>
                        <div className="text-xs text-slate-500 mt-1">
                          {isVoiceSending ? (isVoiceCanceling ? "上滑取消发送" : "松开发送语音给 AI") : "按住说话，停了自动发送，向上滑动可取消"}
                        </div>
                        <Button
                          onClick={handleSendMessage}
                          disabled={!userInput.trim() || isAiTyping}
                          className="h-10 min-w-[96px] rounded-2xl bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          发送
                        </Button>
                        <Button
                          onClick={finishRoleplay}
                          disabled={chatHistory.length < 3 || isEvaluating}
                          className="h-10 min-w-[120px] rounded-2xl bg-slate-900 hover:bg-slate-800 text-white"
                        >
                          {isEvaluating ? <RefreshCw className="w-5 h-5 animate-spin" /> : "结束并评估"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-4 space-y-4">
                    <Card className="border-slate-200 bg-white">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg text-slate-900">当前任务提醒</CardTitle>
                        <CardDescription className="text-slate-700 font-medium">{result?.practiceExercise.aiCharacter}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-base text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3">
                          {result?.practiceExercise.task}
                        </p>
                        <div className="space-y-2">
                          {result?.practiceExercise.hints?.map((hint, idx) => (
                            <div key={idx} className="text-sm text-slate-800 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1">
                              提示 {idx + 1}: {hint}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-slate-200 bg-white">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg text-slate-900">表达建议侧栏</CardTitle>
                        <CardDescription className="text-slate-700">根据你当前输入，给出更地道表达</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                          这个句式历史使用次数：{currentPhraseUsageCount} 次
                        </div>
                        {sameSceneUsage && (
                          <div className="text-sm text-slate-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                            同场景曾使用：{sameSceneUsage.date}
                          </div>
                        )}
                        <div className="text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">
                          <span className="font-semibold">你当前想表达：</span>
                          {userInput.trim() || "（输入一句话后，这里会自动显示）"}
                        </div>
                        {isGeneratingCoach && (
                          <div className="text-sm text-blue-700">正在分析表达意图...</div>
                        )}
                        {expressionCoach && (
                          <div className="space-y-2 text-sm">
                            <p className="text-slate-800"><span className="font-bold">你想表达：</span>{expressionCoach.coreIntent}</p>
                            <button
                              type="button"
                              className="w-full text-left text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-2"
                              onClick={() => sendPreparedMessage(expressionCoach.naturalExpression)}
                            >
                              <span className="font-bold">地道表达（点击发送）：</span>{expressionCoach.naturalExpression}
                            </button>
                            <div className="space-y-1">
                              {expressionCoach.alternatives?.map((alt, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className="block w-full text-left text-slate-800 hover:text-blue-700"
                                  onClick={() => sendPreparedMessage(alt)}
                                >
                                  - {alt}
                                </button>
                              ))}
                            </div>
                            <div className="space-y-1">
                              {expressionCoach.otherScenarios?.map((item, idx) => (
                                <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                                  <p className="text-slate-700 font-semibold">{item.scenario}</p>
                                  <p className="text-slate-600">{item.example}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 pb-12">
                  <div className="text-center space-y-2">
                    <h2 className="text-3xl font-black text-slate-900">练习报告</h2>
                    <p className="text-slate-500">太棒了！您完成了一次高质量的对话练习。</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <Card className="bg-blue-600 text-white border-none p-8 flex flex-col items-center justify-center text-center">
                      <Trophy className="w-12 h-12 mb-4" />
                      <div className="text-5xl font-black mb-1">{evaluation.score}</div>
                      <div className="text-xs font-bold uppercase tracking-widest opacity-70">综合评分</div>
                    </Card>
                    <Card className="md:col-span-3 border-slate-200 p-8 flex flex-col justify-center bg-white">
                      <div className="grid grid-cols-3 gap-8">
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><span>流利度</span><span>{evaluation.fluency}%</span></div>
                          <Progress value={evaluation.fluency} className="h-1.5 bg-slate-100" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><span>准确性</span><span>{evaluation.grammar}%</span></div>
                          <Progress value={evaluation.grammar} className="h-1.5 bg-slate-100" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-500 uppercase"><span>得体度</span><span>{evaluation.politeness}%</span></div>
                          <Progress value={evaluation.politeness} className="h-1.5 bg-slate-100" />
                        </div>
                      </div>
                      <p className="mt-6 text-sm text-slate-600 leading-relaxed italic">"{evaluation.feedback}"</p>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" /> 表达优化建议
                      </h3>
                      <div className="space-y-4">
                        {evaluation.improvedSentences?.map((item, i) => (
                          <Card key={i} className="border-slate-200 bg-white p-5">
                            <div className="space-y-3">
                              <div className="flex items-start gap-3">
                                <Badge variant="outline" className="text-[8px] uppercase border-red-200 text-red-400 mt-1">您的表达</Badge>
                                <p className="text-sm text-slate-400 line-through">{item.original}</p>
                              </div>
                              <div className="flex items-start gap-3">
                                <Badge variant="outline" className="text-[8px] uppercase border-green-200 text-green-600 mt-1">更地道</Badge>
                                <p className="text-sm font-bold text-slate-900">{item.improved}</p>
                              </div>
                              <p className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                <Lightbulb className="w-3 h-3 inline mr-1 text-amber-500" /> {item.reason}
                              </p>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <ArrowRight className="w-5 h-5 text-blue-500" /> 你可以这样说
                      </h3>
                      <div className="space-y-4">
                        {evaluation.expandedGuidance?.map((guide, i) => (
                          <Card key={i} className="border-slate-200 bg-white p-5">
                            <h4 className="font-bold text-blue-900 text-sm mb-2">{guide.topic}</h4>
                            <p className="text-xs text-slate-600 leading-relaxed mb-4 bg-slate-50 p-3 rounded-xl">{guide.explanation}</p>
                            
                            <div className="space-y-4">
                              {guide.scenarios?.map((scen, j) => (
                                <div key={j} className="space-y-2">
                                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">可直接套用场景：{scen.context}</div>
                                  <div className="flex flex-wrap gap-2">
                                    {scen.phrases?.map((phrase, k) => (
                                      <Badge
                                        key={k}
                                        variant="secondary"
                                        className="bg-blue-50 border-blue-100 text-blue-700 text-[10px] whitespace-normal break-words h-auto py-1 leading-relaxed text-left"
                                      >
                                        {phrase}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-100">
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">重点句式与搭配</div>
                              <div className="grid grid-cols-1 gap-2">
                                {guide.keyVocab?.map((v, j) => (
                                  <div key={j} className="text-[11px] flex items-start gap-2">
                                    <span className="font-bold text-blue-600">{v.word}:</span>
                                    <span className="text-slate-600">{v.usage}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center gap-4 pt-8">
                    <Button 
                      onClick={handleNextTask} 
                      disabled={isGeneratingNextTask}
                      className="h-14 px-10 bg-blue-600 hover:bg-blue-700 font-bold rounded-2xl"
                    >
                      {isGeneratingNextTask ? <RefreshCw className="w-5 h-5 animate-spin" /> : "开启下一项任务"}
                    </Button>
                    <Button onClick={reset} variant="outline" className="h-14 px-10 border-slate-300 bg-white text-slate-900 hover:bg-slate-50 font-bold rounded-2xl">
                      回到主页
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === "history" && (
            <motion.div
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-3xl font-black text-slate-900">练习历史</h2>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-slate-500">共完成 {savedSessions.length} 次练习</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAnalyzeHistory}
                    disabled={savedSessions.length === 0 || isAnalyzingHistory}
                  >
                    {isAnalyzingHistory ? "分析中..." : "分析历史对话"}
                  </Button>
                </div>
              </div>

              {historyInsight && (
                <Card className="border-slate-200 bg-white">
                  <CardHeader>
                    <CardTitle>历史表达分析</CardTitle>
                    <CardDescription>总结常用句式、词汇并给出替换方案</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-slate-800">常见句式与优化</h4>
                      {historyInsight.commonPatterns?.map((item, idx) => (
                        <div key={idx} className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700">
                          <span className="font-semibold">{item.pattern}</span>（{item.count} 次） - 问题：{item.issue}；更地道：{item.naturalAlternative}
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-slate-800">高频词汇替换建议</h4>
                      {historyInsight.commonVocabulary?.map((item, idx) => (
                          <div key={idx} className="text-xs bg-blue-50 border border-blue-100 rounded-lg p-2 text-slate-700">
                            <span className="font-semibold">{item.word}</span>（{item.count} 次）{" -> "} {item.betterChoices?.join(" / ")}；{item.note}
                          </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-slate-800">改进行动建议</h4>
                      {historyInsight.actionPlan?.map((plan, idx) => (
                        <div key={idx} className="text-xs text-slate-700">- {plan}</div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {savedSessions.length === 0 ? (
                <div className="text-center py-20 space-y-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                    <History className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-slate-700">还没有练习记录，快去开启您的第一场对话吧！</p>
                  <Button onClick={reset} className="bg-blue-600">去练习</Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-4 space-y-4">
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-3">
                        {savedSessions.map((session) => (
                          <Card 
                            key={session.id} 
                            className={`cursor-pointer transition-all border-slate-200 ${selectedHistory?.id === session.id ? "ring-2 ring-blue-500 border-transparent shadow-lg" : "hover:border-blue-300"}`}
                            onClick={() => setSelectedHistory(session)}
                          >
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start mb-2">
                                <div className="text-sm text-slate-600 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" /> {session.date}
                                </div>
                                <Badge className={session.score >= 80 ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
                                  {session.score} 分
                                </Badge>
                              </div>
                              <h4 className="font-bold text-slate-900 line-clamp-1 text-base">{session.scenarioName}</h4>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="lg:col-span-8">
                    {selectedHistory ? (
                      <Card className="border-slate-200 bg-white h-[600px] flex flex-col">
                        <CardHeader className="border-b border-slate-100 flex flex-row justify-between items-center">
                          <div>
                            <CardTitle className="text-xl font-bold">{selectedHistory.scenarioName}</CardTitle>
                            <CardDescription className="text-slate-700">{selectedHistory.date}</CardDescription>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => deleteSession(selectedHistory.id)} className="text-slate-400 hover:text-red-500">
                            <Trash2 className="w-5 h-5" />
                          </Button>
                        </CardHeader>
                        <CardContent className="p-0 flex-grow overflow-hidden">
                          <ScrollArea className="h-full">
                            <div className="p-6 space-y-8">
                              <div className="grid grid-cols-3 gap-4">
                                <div className="p-4 bg-slate-50 rounded-xl text-center">
                                  <div className="text-2xl font-black text-blue-600">{selectedHistory.evaluation.score}</div>
                                  <div className="text-[10px] font-bold text-slate-400 uppercase">综合得分</div>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-xl text-center">
                                  <div className="text-2xl font-black text-slate-900">{selectedHistory.history.length}</div>
                                  <div className="text-[10px] font-bold text-slate-400 uppercase">对话轮次</div>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-xl text-center">
                                  <div className="text-2xl font-black text-green-600">{selectedHistory.evaluation.improvedSentences?.length || 0}</div>
                                  <div className="text-[10px] font-bold text-slate-400 uppercase">改进建议</div>
                                </div>
                              </div>

                              <div className="space-y-4">
                                <h5 className="text-xs font-bold uppercase tracking-widest text-slate-400">对话回顾</h5>
                                <div className="space-y-3">
                                  {selectedHistory.history.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                      <div className={`max-w-[90%] p-3 rounded-xl text-sm ${msg.role === "user" ? "bg-blue-50 text-blue-900" : "bg-slate-100 text-slate-800"}`}>
                                        {msg.content}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="space-y-4">
                                <h5 className="text-xs font-bold uppercase tracking-widest text-slate-400">常见错误与改进</h5>
                                <div className="space-y-3">
                                  {selectedHistory.evaluation.improvedSentences?.map((item, i) => (
                                    <div key={i} className="p-4 border border-slate-100 rounded-xl space-y-2">
                                      <div className="text-sm text-slate-600 line-through">{item.original}</div>
                                      <div className="text-base font-bold text-slate-900">{item.improved}</div>
                                      <div className="text-xs text-blue-700 italic">Why: {item.reason}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-3xl">
                        <History className="w-12 h-12 mb-4 opacity-20" />
                        <p>选择左侧记录查看详情</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
