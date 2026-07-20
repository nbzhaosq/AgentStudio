import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentDef,
  AgentStatus,
  ChatMessage,
  RoomInfo,
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
      } else if (e.type === "agent_status") {
        setStatuses((prev) => ({
          ...prev,
          [e.roomId]: { ...(prev[e.roomId] ?? {}), [e.agentId]: e.status },
        }));
      } else if (e.type === "agents_changed") {
        void refreshAgents();
      }
    });
    return () => wsRef.current?.close();
  }, [refreshAgents]);

  useEffect(() => {
    if (!activeRoomId) return;
    void api.messages(activeRoomId).then((ms) =>
      setMessages((prev) => ({ ...prev, [activeRoomId]: ms })),
    );
  }, [activeRoomId]);

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
            onSend={send}
          />
          <Roster agents={roomAgents} statuses={statuses[room.id] ?? {}} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-zinc-500">
          创建或选择一个房间开始
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
