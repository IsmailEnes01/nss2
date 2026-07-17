// Session-wide text chat. One instance lives in GameShell and stays mounted
// across every phase past "connecting" — arranging roles, mid-match, after a
// peer leaves — so messages persist through game switches and rematches;
// the DO relays chat regardless of phase or host status, so nothing here
// needs to branch on either. Always expanded at an adjustable footprint (no
// open/close toggle — narrow enough to sit unobtrusively in the corner
// without needing to collapse). `fixed`-positioned at the viewport's
// bottom-left (not `sticky` — this has to stay put even if the page itself
// scrolls, not just some inner container), so it floats outside the
// centered card column everything else renders in.
//
// Resizable from its own top-right corner: since the panel is anchored at
// the viewport's bottom-left, growing "from the top-right corner" is just
// increasing width and height while that anchor stays put — no repositioning
// math needed, only the two dimensions change. Width drives the whole
// `Card` (so the message input row, which is already `w-full`, resizes
// along with it for free); height only drives the scrollable message list,
// since the header and input row keep their natural size regardless.

import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import type { ChatMessage } from "@/features/lobby-session";
import { CHAT_MAX_LENGTH } from "@/shared/lib/lobby-protocol";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_WIDTH_PX = 256; // 16rem, the original fixed width
const MIN_WIDTH_PX = 220;
const MAX_WIDTH_PX = 480;

const DEFAULT_LIST_HEIGHT_PX = 192; // 12rem, the original fixed list height
const MIN_LIST_HEIGHT_PX = 96;
const MAX_LIST_HEIGHT_PX = 480;

const VIEWPORT_MARGIN_PX = 32; // keep clear of the screen edge, same margin the old w-[min(...)] clamp used

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatPanel({ messages, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH_PX);
  const [listHeight, setListHeight] = useState(DEFAULT_LIST_HEIGHT_PX);

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

  function resetSize(): void {
    setWidth(DEFAULT_WIDTH_PX);
    setListHeight(DEFAULT_LIST_HEIGHT_PX);
  }

  /** Drags from the corner handle: horizontal movement resizes the width,
   * vertical movement resizes the message list's height (inverted — dragging
   * UP grows it, since the panel is anchored at the bottom). Pointer capture
   * on the handle itself means the drag keeps tracking even if the cursor
   * strays off the small button, and needs no document-level listener
   * cleanup beyond the pointerup that ends the same capture. */
  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = width;
    const startHeight = listHeight;
    const maxWidth = Math.min(MAX_WIDTH_PX, window.innerWidth - VIEWPORT_MARGIN_PX);
    const maxHeight = Math.min(
      MAX_LIST_HEIGHT_PX,
      window.innerHeight - VIEWPORT_MARGIN_PX,
    );

    function onMove(moveEvent: PointerEvent): void {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = startY - moveEvent.clientY;
      setWidth(clamp(startWidth + deltaX, MIN_WIDTH_PX, maxWidth));
      setListHeight(clamp(startHeight + deltaY, MIN_LIST_HEIGHT_PX, maxHeight));
    }
    function onUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== pointerId) return;
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  return (
    <Card
      className="fixed bottom-4 left-4 z-40 gap-2 shadow-lg"
      style={{ width }}
    >
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Sohbet</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={resetSize}
            aria-label="Sohbet boyutunu sıfırla"
            title="Boyutu sıfırla"
          >
            ↺
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onPointerDown={handleResizeStart}
            aria-label="Sürükleyerek boyutlandır"
            title="Sürükleyerek boyutlandır"
            className="cursor-nesw-resize touch-none"
          >
            ↗
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <div
          ref={listRef}
          className="flex flex-col overflow-y-auto"
          style={{ height: listHeight }}
        >
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

/** Clamps a resize dimension to its declared range — the drag handler's own
 * safety net, same "never trust the raw delta" spirit as every settings
 * value clamp elsewhere in the app. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
