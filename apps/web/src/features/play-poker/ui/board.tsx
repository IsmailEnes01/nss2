// Teksas Hold'em board: a pot/street header, the community card row, one
// row per seat (stack, status, hole cards), the action bar when it's my
// turn, and a "last hand" banner once one exists. Presentational only —
// renders `state`, calls `onMove`, honors `canMove`. Hole cards are derived
// on demand via `pokerHoleCards`/`pokerCommunityCards` (never stored in
// `state`): a live opponent's hand is always rendered face-down here — the
// only place their actual cards ever surface is `lastResult.revealedHands`,
// and only for the hand that just finished, same trust model as every other
// game's hidden information.

import { useEffect, useState } from "react";
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { type Card, isRedSuit, rankLabel, suitSymbol } from "../config/deck";
import {
  legalActionsFor,
  pokerCommunityCards,
  pokerGame,
  pokerHoleCards,
  pokerPotTotal,
  type PokerHandResult,
  type PokerMove,
  type PokerState,
  type Street,
} from "../model/rules";

export function PokerBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<PokerState, PokerMove>) {
  const status = pokerGame.status(state);

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <PotHeader state={state} />
      <CommunityCards state={state} />

      <div className="flex flex-col gap-2">
        {Array.from({ length: state.playerCount }, (_, seat) => (
          <SeatRow key={seat} state={state} seat={seat} me={me} />
        ))}
      </div>

      {status.kind === "won" ? (
        <MatchOverCard state={state} me={me} />
      ) : (
        canMove && <ActionBar state={state} me={me} onMove={onMove} />
      )}

      {state.lastResult !== null && (
        <LastHandBanner result={state.lastResult} me={me} />
      )}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

const STREET_LABELS: Readonly<Record<Street, string>> = {
  preflop: "İlk tur",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

function PotHeader({ state }: { state: PokerState }) {
  return (
    <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-2 text-sm">
      <span className="text-muted-foreground">{STREET_LABELS[state.street]}</span>
      <span className="font-mono font-semibold">
        Pot: ${pokerPotTotal(state)}
      </span>
      <span className="text-xs text-muted-foreground">
        Kör: ${state.smallBlind}/${state.bigBlind}
      </span>
    </div>
  );
}

function CommunityCards({ state }: { state: PokerState }) {
  const revealed = pokerCommunityCards(state);
  return (
    <div className="flex justify-center gap-1.5">
      {Array.from({ length: 5 }, (_, i) =>
        i < revealed.length ? (
          <PlayingCard key={i} card={revealed[i]} />
        ) : (
          <CardSlot key={i} />
        ),
      )}
    </div>
  );
}

function SeatRow({ state, seat, me }: SeatRowProps) {
  const isMe = seat === me;
  const eliminated = state.eliminated[seat];
  const folded = state.folded[seat];
  const toAct = state.toAct === seat;
  const hole = isMe ? pokerHoleCards(state, seat) : null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm",
        toAct && "border-primary ring-2 ring-primary/30",
        (eliminated || folded) && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <span className="flex items-center gap-1 text-xs">
            {pokerGame.playerLabel(seat)}
            {isMe && " (sen)"}
            {seat === state.dealerSeat && (
              <Badge variant="outline" className="px-1">
                D
              </Badge>
            )}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            ${state.stacks[seat]}
          </span>
        </div>
        {eliminated ? (
          <Badge variant="secondary">Elendi</Badge>
        ) : folded ? (
          <Badge variant="outline">Katlandı</Badge>
        ) : state.allIn[seat] ? (
          <Badge>All-in</Badge>
        ) : state.betThisStreet[seat] > 0 ? (
          <Badge variant="outline">${state.betThisStreet[seat]}</Badge>
        ) : null}
      </div>

      <div className="flex gap-1">
        {eliminated || folded ? null : isMe ? (
          hole === null ? (
            <>
              <CardSlot small />
              <CardSlot small />
            </>
          ) : (
            <>
              <PlayingCard card={hole[0]} small />
              <PlayingCard card={hole[1]} small />
            </>
          )
        ) : (
          <>
            <CardBack small />
            <CardBack small />
          </>
        )}
      </div>
    </div>
  );
}

function ActionBar({ state, me, onMove }: ActionBarProps) {
  const legal = legalActionsFor(state, me);
  const defaultAmount = legal === null
    ? state.bigBlind
    : legal.canRaise
      ? legal.minRaiseTo
      : legal.minBet;
  const [amount, setAmount] = useState(defaultAmount);

  // A fresh decision point (a new turn, a new street, or a raise upstream
  // changing the numbers) always gets a fresh sane default — a leftover
  // draft from a previous decision would otherwise carry over as noise.
  useEffect(() => {
    setAmount(defaultAmount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.toAct, state.street, state.currentBet]);

  if (legal === null) return null;

  const myStack = state.stacks[me];
  const maxAmount = myStack + state.betThisStreet[me];
  const minAmount = legal.canRaise ? legal.minRaiseTo : legal.minBet;
  const amountValid = amount >= minAmount && amount <= maxAmount;

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onMove({ t: "fold" })}>
          Pas Geç
        </Button>
        {legal.canCheck && (
          <Button variant="outline" onClick={() => onMove({ t: "check" })}>
            Kontrol Et
          </Button>
        )}
        {legal.canCall && (
          <Button onClick={() => onMove({ t: "call" })}>
            Gör (${legal.callAmount})
          </Button>
        )}
        {legal.canAllIn && (
          <Button variant="destructive" onClick={() => onMove({ t: "allIn" })}>
            Hepsi (${myStack})
          </Button>
        )}
      </div>
      {(legal.canBet || legal.canRaise) && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={amount}
            min={minAmount}
            max={maxAmount}
            step={1}
            onChange={(event) => setAmount(Number(event.target.value))}
            className="w-28"
            aria-label="Bahis miktarı"
          />
          <Button
            onClick={() =>
              onMove(
                legal.canRaise
                  ? { t: "raise", amount }
                  : { t: "bet", amount },
              )
            }
            disabled={!amountValid}
          >
            {legal.canRaise ? `Yükselt ($${amount})` : `Bahis Yap ($${amount})`}
          </Button>
        </div>
      )}
    </div>
  );
}

function LastHandBanner({ result, me }: { result: PokerHandResult; me: PlayerIndex }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
      <p className="text-center text-xs text-muted-foreground">
        Son el sonucu
      </p>
      <ul className="flex flex-col gap-1">
        {result.potsWon.map((pot, index) => (
          <li key={index} className="text-center">
            {pot.seats
              .map(
                (seat) =>
                  pokerGame.playerLabel(seat) + (seat === me ? " (sen)" : ""),
              )
              .join(", ")}{" "}
            {pot.handLabel === null
              ? `— rakipler katıldığı için $${pot.amount} kazandı`
              : `— ${pot.handLabel} ile $${pot.amount} kazandı`}
          </li>
        ))}
      </ul>
      {result.revealedHands.length > 0 && (
        <div className="flex flex-wrap justify-center gap-3">
          {result.revealedHands.map(({ seat, cards }) => (
            <div key={seat} className="flex flex-col items-center gap-1">
              <span className="text-xs text-muted-foreground">
                {pokerGame.playerLabel(seat)}
                {seat === me && " (sen)"}
              </span>
              <div className="flex gap-1">
                {cards.map((card, index) => (
                  <PlayingCard key={index} card={card} small />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {result.bustedSeats.length > 0 && (
        <p className="text-center text-xs text-destructive">
          {result.bustedSeats
            .map((seat) => pokerGame.playerLabel(seat))
            .join(", ")}{" "}
          masadan düştü.
        </p>
      )}
    </div>
  );
}

function MatchOverCard({ state, me }: { state: PokerState; me: PlayerIndex }) {
  const status = pokerGame.status(state);
  const ranked = state.stacks
    .map((chips, seat) => ({ seat, chips }))
    .sort((a, b) => b.chips - a.chips);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-center">
      <p className="text-lg font-semibold">
        {status.kind === "won"
          ? status.winner === me
            ? "Kazandın! 🎉"
            : `${pokerGame.playerLabel(status.winner)} kazandı`
          : "Berabere!"}
      </p>
      <ol className="flex flex-col gap-1">
        {ranked.map(({ seat, chips }) => (
          <li key={seat} className="flex items-center justify-between text-sm">
            <span
              className={seat === me ? "font-semibold" : "text-muted-foreground"}
            >
              {pokerGame.playerLabel(seat)}
              {seat === me && " (sen)"}
            </span>
            <span className="font-mono">${chips}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A face-up card — red for hearts/diamonds, otherwise the default text
 * color (no separate "black suit" color needed). */
function PlayingCard({ card, small }: { card: Card; small?: boolean }) {
  const red = isRedSuit(card.suit);
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-md border bg-card font-mono font-semibold shadow-sm",
        small ? "h-10 w-7 text-xs" : "h-14 w-10 text-sm",
        red ? "text-red-500" : "text-foreground",
      )}
    >
      <span>{rankLabel(card.rank)}</span>
      <span>{suitSymbol(card.suit)}</span>
    </div>
  );
}

/** An opponent's still-hidden hole card. */
function CardBack({ small }: { small?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md border bg-muted text-muted-foreground",
        small ? "h-10 w-7 text-xs" : "h-14 w-10 text-sm",
      )}
    >
      🂠
    </div>
  );
}

/** An empty, not-yet-dealt slot — visually distinct from a face-down card so
 * "nothing here yet" doesn't read as "hidden card." */
function CardSlot({ small }: { small?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-muted-foreground/30",
        small ? "h-10 w-7" : "h-14 w-10",
      )}
    />
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SeatRowProps {
  state: PokerState;
  seat: PlayerIndex;
  me: PlayerIndex;
}

interface ActionBarProps {
  state: PokerState;
  me: PlayerIndex;
  onMove(move: PokerMove): void;
}
