import { randomUUID } from "node:crypto";

import {
  EventIdSchema,
  LiveEventSchema,
  ThreadIdSchema,
  type ThreadId,
} from "@pi-web/contracts";

export interface LiveSocket {
  readonly bufferedAmount: number;
  send(data: string): void;
}

interface Channel {
  epoch: string;
  sequence: number;
  events: string[];
  eventBytes: number;
  sockets: Set<LiveSocket>;
}

export class LiveBroker {
  private readonly channels = new Map<ThreadId, Channel>();

  private channel(threadId: ThreadId): Channel {
    let channel = this.channels.get(threadId);
    if (channel === undefined) {
      channel = {
        epoch: randomUUID(),
        sequence: 0,
        events: [],
        eventBytes: 0,
        sockets: new Set(),
      };
      this.channels.set(threadId, channel);
    }
    return channel;
  }

  public cursor(rawThreadId: string): { epoch: string; sequence: number } {
    const threadId = ThreadIdSchema.parse(rawThreadId);
    const channel = this.channel(threadId);
    return { epoch: channel.epoch, sequence: channel.sequence };
  }

  public publish(
    rawThreadId: string,
    eventType: "transcript" | "run" | "completion" | "diagnostic",
    payload: unknown,
  ): void {
    const threadId = ThreadIdSchema.parse(rawThreadId);
    const channel = this.channel(threadId);
    channel.sequence += 1;
    const event = LiveEventSchema.parse({
      version: 1,
      type: "event",
      threadId,
      epoch: channel.epoch,
      sequence: channel.sequence,
      eventId: EventIdSchema.parse(randomUUID()),
      eventType,
      payload,
    });
    const serialized = JSON.stringify(event);
    channel.events.push(serialized);
    channel.eventBytes += Buffer.byteLength(serialized);
    while (channel.events.length > 1_000 || channel.eventBytes > 1_048_576) {
      const removed = channel.events.shift();
      if (removed !== undefined)
        channel.eventBytes -= Buffer.byteLength(removed);
    }
    for (const socket of channel.sockets) {
      if (socket.bufferedAmount > 1_048_576) {
        channel.sockets.delete(socket);
        continue;
      }
      socket.send(serialized);
    }
  }

  public subscribe(
    rawThreadId: string,
    socket: LiveSocket,
    epoch?: string,
    cursor?: number,
  ): () => void {
    const threadId = ThreadIdSchema.parse(rawThreadId);
    const channel = this.channel(threadId);
    channel.sockets.add(socket);
    if (epoch !== undefined && cursor !== undefined) {
      const first =
        channel.events[0] === undefined
          ? channel.sequence + 1
          : LiveEventSchema.parse(JSON.parse(channel.events[0])).sequence;
      if (
        epoch !== channel.epoch ||
        cursor > channel.sequence ||
        cursor + 1 < first
      ) {
        socket.send(
          JSON.stringify({ version: 1, type: "snapshot_required", threadId }),
        );
      } else {
        for (const serialized of channel.events) {
          const parsed = LiveEventSchema.safeParse(JSON.parse(serialized));
          if (parsed.success && parsed.data.sequence > cursor)
            socket.send(serialized);
        }
      }
    } else {
      socket.send(
        JSON.stringify({ version: 1, type: "snapshot_required", threadId }),
      );
    }
    return () => channel.sockets.delete(socket);
  }

  public clear(): void {
    this.channels.clear();
  }
}
