/**
 * 주소 이전 안내의 회귀 테스트.
 * 옛 주소(human-proofreader-mcp.vercel.app)로 들어온 사람에게만 새 주소를 알려야 한다.
 * 새 주소로 들어온 사람에게 "옮겼다" 고 하면 오히려 헷갈린다.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { movedFrom, requestOrigin } from "../lib/site";

const NEW = "https://human-proofreader-mcp.toy.x.upstage.ai";
const OLD = "https://human-proofreader-mcp.vercel.app";

test("옛 주소로 들어오면 그 주소를 돌려준다", () => {
  assert.equal(movedFrom(OLD, NEW), OLD);
});

test("정식 주소로 들어오면 안내하지 않는다", () => {
  assert.equal(movedFrom(NEW, NEW), null);
});

// 프록시가 대문자·포트 없는 호스트를 섞어 보낼 수 있다. 호스트만 비교한다.
test("호스트 표기 차이(대소문자·끝 슬래시)는 같은 주소로 본다", () => {
  assert.equal(movedFrom("https://Human-Proofreader-MCP.toy.x.upstage.ai/", NEW), null);
});

test("로컬 개발에서는 안내하지 않는다", () => {
  assert.equal(movedFrom("http://localhost:3000", NEW), null);
  assert.equal(movedFrom("http://127.0.0.1:3000", NEW), null);
});

test("요청 주소를 모르면 안내하지 않는다", () => {
  assert.equal(movedFrom(null, NEW), null);
});

// Vercel rewrites 는 원래 호스트를 x-forwarded-host 로 넘긴다. 이걸 먼저 봐야 옛 주소를 알아챈다.
test("x-forwarded-host 를 host 보다 먼저 본다", () => {
  const h = new Headers({ host: "human-proofreader-mcp.toy.x.upstage.ai", "x-forwarded-host": "human-proofreader-mcp.vercel.app" });
  assert.equal(requestOrigin(h), OLD);
});

test("localhost 는 http 로 본다", () => {
  assert.equal(requestOrigin(new Headers({ host: "localhost:3000" })), "http://localhost:3000");
});
