/**
 * Solar 호출 계층 — 무료 티어(서버 키)와 BYOK(사용자 키)를 한 인터페이스로 묶는다.
 *
 * 키를 받는 경로는 HTTP 헤더뿐이다. 도구 인자로 받으면 클라이언트 대화 기록에
 * 평문으로 남고, 그건 되돌릴 수 없다.
 *
 *   X-Upstage-Api-Key     : Upstage 직접 호출 (api.upstage.ai)
 *   X-OpenRouter-Api-Key  : OpenRouter 경유 (openrouter.ai)
 *
 * 둘 다 없으면 서버 키로 무료 티어를 쓴다.
 */

import { header } from "./context";

export type ProviderMode = "byok-upstage" | "byok-openrouter" | "free";

export interface Provider {
  mode: ProviderMode;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** BYOK는 무료 한도를 소모하지 않는다. */
  metered: boolean;
  label: string;
  reasoningEffort?: string;
}

const UPSTAGE_BASE = process.env.UPSTAGE_BASE_URL ?? "https://api.upstage.ai/v1";
const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const UPSTAGE_MODEL = process.env.UPSTAGE_MODEL ?? "solar-pro4";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "upstage/solar-pro4";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: "no_key" | "upstream" | "config",
  ) {
    super(message);
  }
}

export function resolveProvider(): Provider {
  const upstageKey = header("x-upstage-api-key");
  if (upstageKey) {
    return {
      mode: "byok-upstage",
      baseUrl: UPSTAGE_BASE,
      apiKey: upstageKey,
      model: UPSTAGE_MODEL,
      metered: false,
      label: `Upstage 직접 (BYOK) · ${UPSTAGE_MODEL}`,
    };
  }

  const orKey = header("x-openrouter-api-key");
  if (orKey) {
    return {
      mode: "byok-openrouter",
      baseUrl: OPENROUTER_BASE,
      apiKey: orKey,
      model: OPENROUTER_MODEL,
      metered: false,
      label: `OpenRouter (BYOK) · ${OPENROUTER_MODEL}`,
    };
  }

  const serverUpstage = process.env.UPSTAGE_API_KEY;
  const serverOpenRouter = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const baseUrl = process.env.OPENAI_BASE_URL?.replace(/\/+$/, "");
    if (!baseUrl || !/^https?:\/\/[^/\s]+/.test(baseUrl)) {
      throw new ProviderError("OPENAI_BASE_URL에 제공자의 HTTP(S) API 주소를 설정하세요.", "config");
    }
    const model = process.env.OPENAI_MODEL?.trim();
    if (!model) {
      throw new ProviderError("OPENAI_MODEL에 제공자가 지원하는 모델 ID를 설정하세요.", "config");
    }
    const reasoningEffort = process.env.OPENAI_REASONING_EFFORT?.trim() || undefined;
    if (reasoningEffort && !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoningEffort)) {
      throw new ProviderError("OPENAI_REASONING_EFFORT 값이 올바르지 않습니다.", "config");
    }
    return {
      mode: "free",
      baseUrl,
      apiKey: openaiKey,
      model,
      metered: true,
      label: `OpenAI 호환 · ${model}${reasoningEffort ? `:${reasoningEffort}` : ""}`,
      reasoningEffort,
    };
  }
  if (process.env.OPENAI_BASE_URL || process.env.OPENAI_MODEL || process.env.OPENAI_REASONING_EFFORT) {
    throw new ProviderError("OpenAI 호환 설정에 OPENAI_API_KEY가 없습니다.", "no_key");
  }
  if (serverOpenRouter) {
    return {
      mode: "free",
      baseUrl: OPENROUTER_BASE,
      apiKey: serverOpenRouter,
      model: OPENROUTER_MODEL,
      metered: true,
      label: `무료 티어 (OpenRouter) · ${OPENROUTER_MODEL}`,
    };
  }
  if (serverUpstage) {
    return {
      mode: "free",
      baseUrl: UPSTAGE_BASE,
      apiKey: serverUpstage,
      model: UPSTAGE_MODEL,
      metered: true,
      label: `무료 티어 (Upstage) · ${UPSTAGE_MODEL}`,
    };
  }

  throw new ProviderError(
    "서버 키가 없습니다. OPENAI_API_KEY와 OPENAI_BASE_URL을 설정하거나, 요청 헤더에 X-Upstage-Api-Key 또는 X-OpenRouter-Api-Key를 넣으세요.",
    "no_key",
  );
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 한 번 실패했을 때만 재시도한다. 교정 품질보다 응답 시간이 중요하다. */
  retries?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export async function chat(
  provider: Provider,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const { temperature = 0.4, maxTokens = 16000, retries = 1, timeoutMs = 120_000 } = opts;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.baseUrl.includes("openrouter")) {
    // OpenRouter 대시보드에서 이 서버의 트래픽을 알아볼 수 있게 한다.
    headers["HTTP-Referer"] =
      process.env.PUBLIC_URL ?? "https://github.com/hunkim/solar-human-proofreader";
    headers["X-Title"] = "Solar Human Proofreader";
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: provider.model,
          messages,
          ...(provider.reasoningEffort
            ? { reasoning_effort: provider.reasoningEffort, max_completion_tokens: maxTokens }
            : { temperature, max_tokens: maxTokens }),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        // 4xx는 재시도해도 같은 답이 온다 — 키·요청이 잘못된 것이다.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new ProviderError(
            `Solar 호출 실패 (${res.status}): ${body.slice(0, 300)}`,
            "upstream",
          );
        }
        throw new Error(`Solar 호출 실패 (${res.status}): ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: ChatResult["usage"];
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error("Solar가 빈 응답을 돌려줬습니다.");
      return { text, model: provider.model, usage: json.usage };
    } catch (err) {
      lastError = err;
      if (err instanceof ProviderError) throw err;
      if (attempt === retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ProviderError(
    `Solar 호출에 실패했습니다: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    "upstream",
  );
}
