// Session-wide text chat. One instance lives in GameShell and stays mounted
// across every phase past "connecting" — arranging roles, mid-match, after a
// peer leaves — so messages persist through game switches and rematches;
// the DO relays chat regardless of phase or host status, so nothing here
// needs to branch on either. Always expanded at a fixed footprint (no
// open/close toggle — narrow enough to sit unobtrusively in the corner
// without needing to collapse). `fixed`-positioned at the viewport's
// bottom-left (not `sticky` — this has to stay put even if the page itself
// scrolls, not just some inner container), so it floats outside the
// centered card column everything else renders in.

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ChatMessage } from "@/features/lobby-session";
import { CHAT_MAX_LENGTH } from "@/shared/lib/lobby-protocol";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatPanel({ messages, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Always visible, so every new message should pin the view to the bottom.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const text = draft.trim();
    if (text === "") return;
    onSend(text);
    setDraft("");
  }

  return (
    <Card className="fixed bottom-4 left-4 z-40 w-[min(16rem,calc(100vw-2rem))] gap-2 shadow-lg">
      <CardHeader>
        <CardTitle>Sohbet</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <div ref={listRef} className="flex h-48 flex-col overflow-y-auto">
          {messages.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Henüz mesaj yok.
            </p>
          ) : (
            messages.map((message, index) => (
              <ChatBubble
                key={message.id}
                message={message}
                // Same sender as the message right before it → part of the
                // same run: no repeated name, tighter spacing, a flatter
                // corner on the side that "connects" to the bubble above.
                grouped={messages[index - 1]?.from === message.from}
              />
            ))
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={CHAT_MAX_LENGTH}
            placeholder="Mesaj yaz…"
            aria-label="Mesaj yaz"
          />
          <Button
            type="submit"
            size="icon-xs"
            disabled={draft.trim() === ""}
            aria-label="Gönder"
          >
            ➤
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** `grouped` means the message right above it is from the same sender — the
 * name is only worth stating once per run, and the run reads as one merged
 * balloon rather than a stack of separate ones (tight spacing, a squared-off
 * corner on the side that abuts the previous bubble). */
function ChatBubble({ message, grouped }: ChatBubbleProps) {
  return (
    <div
      className={cn(
        "flex max-w-[85%] flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-sm",
        grouped ? "mt-0.5" : "mt-2 first:mt-0",
        message.self
          ? cn(
              "self-end bg-primary/10 text-right",
              grouped && "rounded-tr-sm",
            )
          : cn("self-start bg-muted", grouped && "rounded-tl-sm"),
      )}
    >
      {!message.self && !grouped && (
        <span className="text-xs font-semibold text-muted-foreground">
          {message.fromName}
        </span>
      )}
      <span className="whitespace-pre-wrap break-words">{message.text}</span>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatPanelProps {
  messages: readonly ChatMessage[];
  onSend(text: string): void;
}

interface ChatBubbleProps {
  message: ChatMessage;
  /** Same sender as the previous message in the list. */
  grouped: boolean;
}
