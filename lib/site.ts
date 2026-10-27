/**
 * 이 배포본의 실제 주소.
 *
 * 랜딩 페이지가 `<your-deployment>` 같은 자리표시자를 보여 주면, 그 페이지를
 * AI에게 넘겨도 설치가 되지 않는다. 요청 헤더에서 자기 주소를 읽어 설정
 * 스니펫에 그대로 박아야 "이 URL 좀 붙여 줘"가 한 번에 끝난다.
 */

import { headers } from "next/headers";

export async function getBaseUrl(): Promise<string> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");

  const origin = requestOrigin(await headers());
  if (origin) return origin;

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * 방문자가 실제로 친 주소. 프록시(Vercel rewrites)를 거치면 원래 호스트는
 * x-forwarded-host 에 있으므로 그쪽을 먼저 본다.
 */
export function requestOrigin(h: Headers): string | null {
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host");
  if (!host) return null;
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * 방문자가 정식 주소가 아닌 곳(옛 주소)으로 들어왔다면 그 주소를, 아니면 null.
 * 주소를 옮긴 뒤 옛 주소로 온 사람에게만 "옮겼다" 고 알리는 데 쓴다.
 */
export function movedFrom(visited: string | null, canonical: string): string | null {
  if (!visited) return null;
  let v: URL;
  let c: URL;
  try {
    v = new URL(visited);
    c = new URL(canonical);
  } catch {
    return null;
  }
  if (v.hostname === "localhost" || v.hostname === "127.0.0.1") return null;
  if (v.host.toLowerCase() === c.host.toLowerCase()) return null;
  return `${v.protocol}//${v.host}`;
}

/** 지금 요청이 정식 주소(PUBLIC_URL)가 아닌 곳으로 들어왔다면 그 주소. */
export async function getMovedFrom(): Promise<string | null> {
  if (!process.env.PUBLIC_URL) return null;
  return movedFrom(requestOrigin(await headers()), process.env.PUBLIC_URL);
}

export const SERVER_NAME = "human-proofreader";

export const TOOL_SUMMARY: Array<{ name: string; desc: string; cost: string }> = [
  { name: "proofread", desc: "원고를 통독하고 교정본을 돌려준다. 이 서버의 본체.", cost: "1~3콜" },
  { name: "read_through", desc: "고치지 않고, 왜 안 읽히는지 소견만 준다.", cost: "1콜" },
  { name: "readability", desc: "문장 길이·번역투·피동·리듬을 0~100점으로 잰다.", cost: "무료" },
  { name: "compare", desc: "원본과 교정본을 대조해 사실·인용·문체 훼손을 잡는다.", cost: "무료" },
  { name: "suggest", desc: "한 대목을 결이 다른 여러 안으로 다시 써 준다.", cost: "1콜" },
  { name: "usage", desc: "오늘 남은 무료 한도를 확인한다.", cost: "무료" },
];
