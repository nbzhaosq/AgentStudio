#!/usr/bin/env node
// 演示/测试用 mock agent：不调用任何模型，按固定规则回复。
// 用法: node mock-agent.mjs <selfId> <peerId> <prompt>
// 规则：TRIGGER 文本包含 "relay" → 回复 "@<peer> relay"；否则回复 ack（不 @ 人，链结束）。
const [selfId, peerId, prompt] = process.argv.slice(2);

const triggerIdx = prompt.lastIndexOf("=== TRIGGER");
const triggerText = triggerIdx >= 0 ? prompt.slice(triggerIdx) : prompt;

// 只有人类用户发起的 "relay" 才接力，agent 之间的接力直接 ack，避免乒乓。
const fromUser = /\[user\]:/.test(triggerText);
if (fromUser && /relay/i.test(triggerText)) {
  console.log(`@${peerId} relay`);
} else {
  console.log(`ack from ${selfId}, noted.`);
}
