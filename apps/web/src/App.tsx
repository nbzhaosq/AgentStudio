import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentDef,
  AgentStatus,
  ChatMessage,
  RoomInfo,
  SessionInfo,
} from "@agent-studio/shared";
import { api, connectWS } from "./api";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import Roster from "./components/Roster";
import AgentsPanel from "./components/AgentsPanel";

export default function App() {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [statuses, setStatuses] = useState<
    Record<string, Record<string, AgentStatus>>
  >({});
  /** roomId → agentId（"_ws" 表示无法归属）→ 最近改动路径 */
  const [activities, setActivities] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [sessions, setSessions] = useState<Record<string, SessionInfo[]>>({});
  /** roomId → agentId → 流式草稿 */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [streaming, setStreaming] = useState(
    () => localStorage.getItem("as-streaming") !== "off",
  );
  const wsRef = useRef<WebSocket | null>(null);

  const refreshAgents = useCallback(() => api.agents().then(setAgents), []);

  useEffect(() => {
    void refreshAgents();
    void api.rooms().then((rs) => {
      setRooms(rs);
      if (rs.length > 0) setActiveRoomId((cur) => cur ?? rs[0].id);
    });
  }, [refreshAgents]);

  useEffect(() => {
    wsRef.current = connectWS((e) => {
      if (e.type === "message") {
        const m = e.message;
        setMessages((prev) => ({
          ...prev,
          [m.roomId]: [...(prev[m.roomId] ?? []), m],
        }));
        // 正式消息到达，清掉该 agent 的草稿
        if (m.kind === "agent") {
          setDrafts((prev) => {
            const roomDrafts = { ...(prev[m.roomId] ?? {}) };
            delete roomDrafts[m.author];
            return { ...prev, [m.roomId]: roomDrafts };
          });
        }
      } else if (e.type === "draft") {
        setDrafts((prev) => {
          const roomDrafts = { ...(prev[e.roomId] ?? {}) };
          if (e.text) roomDrafts[e.agentId] = e.text;
          else delete roomDrafts[e.agentId];
          return { ...prev, [e.roomId]: roomDrafts };
        });
      } else if (e.type === "agent_status") {
        setStatuses((prev) => ({
          ...prev,
          [e.roomId]: { ...(prev[e.roomId] ?? {}), [e.agentId]: e.status },
        }));
      } else if (e.type === "agents_changed") {
        void refreshAgents();
      } else if (e.type === "rooms_changed") {
        void api.rooms().then(setRooms);
      } else if (e.type === "sessions_changed") {
        void api.roomSessions(e.roomId).then((ss) =>
          setSessions((prev) => ({ ...prev, [e.roomId]: ss })),
        );
      } else if (e.type === "agent_activity") {
        const key = e.agentId ?? "_ws";
        setActivities((prev) => {
          const roomActs = { ...(prev[e.roomId] ?? {}) };
          roomActs[key] = [...(roomActs[key] ?? []), ...e.paths].slice(-10);
          return { ...prev, [e.roomId]: roomActs };
        });
      }
    });
    return () => wsRef.current?.close();
  }, [refreshAgents]);

  useEffect(() => {
    if (!activeRoomId) return;
    void api.messages(activeRoomId).then((ms) =>
      setMessages((prev) => ({ ...prev, [activeRoomId]: ms })),
    );
    void api.roomSessions(activeRoomId).then((ss) =>
      setSessions((prev) => ({ ...prev, [activeRoomId]: ss })),
    );
    // 加入房间时同步流式开关
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "set_streaming", roomId: activeRoomId, streaming }),
      );
    }
  }, [activeRoomId, streaming]);

  const toggleStreaming = useCallback(() => {
    setStreaming((v) => {
      const next = !v;
      localStorage.setItem("as-streaming", next ? "on" : "off");
      return next;
    });
  }, []);

  const send = useCallback(
    (text: string) => {
      if (!activeRoomId || wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(
        JSON.stringify({ type: "send_message", roomId: activeRoomId, text }),
      );
    },
    [activeRoomId],
  );

  const room = rooms.find((r) => r.id === activeRoomId) ?? null;
  const roomAgents = room
    ? agents.filter((a) => room.agentIds.includes(a.id))
    : [];

  const addAgentToRoom = useCallback(
    (agentId: string) => {
      if (!room) return;
      void api
        .updateRoomAgents(room.id, [...room.agentIds, agentId])
        .then((updated) =>
          setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r))),
        );
    },
    [room],
  );

  const resetSession = useCallback(
    (agentId?: string) => {
      if (!room) return;
      void api.deleteRoomSession(room.id, agentId).then(() =>
        api.roomSessions(room.id).then((ss) =>
          setSessions((prev) => ({ ...prev, [room.id]: ss })),
        ),
      );
    },
    [room],
  );

  const removeAgentFromRoom = useCallback(
    (agentId: string) => {
      if (!room) return;
      void api
        .updateRoomAgents(room.id, room.agentIds.filter((id) => id !== agentId))
        .then((updated) =>
          setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r))),
        );
    },
    [room],
  );

  return (
    <div className="flex h-full">
      <Sidebar
        rooms={rooms}
        activeRoomId={activeRoomId}
        agents={agents}
        onSelect={setActiveRoomId}
        onManageAgents={() => setShowAgents(true)}
        onCreated={(r) => {
          setRooms((prev) => [...prev, r]);
          setActiveRoomId(r.id);
        }}
      />
      {room ? (
        <>
          <ChatView
            room={room}
            agents={roomAgents}
            messages={messages[room.id] ?? []}
            statuses={statuses[room.id] ?? {}}
            activities={activities[room.id] ?? {}}
            drafts={drafts[room.id] ?? {}}
            streaming={streaming}
            onToggleStreaming={toggleStreaming}
            onSend={send}
          />
          <Roster
            agents={roomAgents}
            statuses={statuses[room.id] ?? {}}
            activities={activities[room.id] ?? {}}
            candidates={agents.filter((a) => !room.agentIds.includes(a.id))}
            onAddAgent={addAgentToRoom}
            onRemoveAgent={removeAgentFromRoom}
            sessions={sessions[room.id] ?? []}
            onResetSession={resetSession}
          />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="3" fill="#22d3ee" opacity="0.9" />
            <circle cx="18" cy="8" r="3" fill="#34d399" opacity="0.85" />
            <circle cx="11" cy="18" r="3" fill="#facc15" opacity="0.85" />
            <path d="M8.5 7.5 15 8M7 9l3 6.5M16.5 10.5 12.5 15.5" stroke="#52525b" strokeWidth="1.2" />
          </svg>
          <p className="text-sm text-text-3">创建或选择一个房间开始</p>
        </div>
      )}
      {showAgents && (
        <AgentsPanel
          agents={agents}
          onClose={() => setShowAgents(false)}
          onChanged={() => void refreshAgents()}
        />
      )}
    </div>
  );
}
