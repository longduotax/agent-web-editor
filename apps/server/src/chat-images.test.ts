import multipart from "@fastify/multipart";
import { ChatCommandMultipartMetadataSchema } from "@pi-web/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseChatImageBytes, parseMultipartChatInput } from "./chat-images.js";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

function multipartBody(
  metadata: unknown,
  files: readonly { name: string; contentType: string; bytes: Buffer }[],
): { boundary: string; body: Buffer } {
  const boundary = "pi-web-image-boundary";
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    ),
  ];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="${file.name}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

async function multipartServer() {
  const server = Fastify();
  await server.register(multipart);
  server.post("/chat", async (request) => {
    const parsed = await parseMultipartChatInput(
      request,
      ChatCommandMultipartMetadataSchema,
    );
    return {
      text: parsed.input.text,
      images: parsed.input.images.map((image) => ({
        mimeType: image.mimeType,
        bytes: image.data.byteLength,
        digest: image.digest,
      })),
    };
  });
  return server;
}

describe("chat image byte parsing", () => {
  it.each([
    [png(800, 600), "image/png", 800, 600],
    [jpeg(1024, 768), "image/jpeg", 1024, 768],
    [webp(320, 240), "image/webp", 320, 240],
  ] as const)(
    "detects supported bytes rather than browser labels",
    (bytes, mimeType, width, height) => {
      expect(parseChatImageBytes(bytes)).toEqual({ mimeType, width, height });
    },
  );

  it("rejects unsupported bytes", () => {
    expect(() => parseChatImageBytes(Buffer.from("not an image"))).toThrow(
      "chat_image_unsupported",
    );
  });

  it("rejects excessive decoded dimensions before image decoding", () => {
    expect(() => parseChatImageBytes(png(10_000, 10_000))).toThrow(
      "chat_image_pixels_exceeded",
    );
  });
});

describe("multipart chat image boundary", () => {
  const metadata = {
    prompt: "Look at this",
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
  };

  it("parses ordered image bytes and ignores a spoofed part MIME label", async () => {
    const server = await multipartServer();
    const request = multipartBody(metadata, [
      { name: "photo.jpg", contentType: "text/plain", bytes: png(2, 3) },
    ]);
    const response = await server.inject({
      method: "POST",
      url: "/chat",
      headers: {
        "content-type": `multipart/form-data; boundary=${request.boundary}`,
      },
      payload: request.body,
    });
    expect(response.statusCode).toBe(200);
    const value = z
      .object({
        text: z.string(),
        images: z.array(
          z.object({
            mimeType: z.string(),
            bytes: z.number(),
            digest: z.string(),
          }),
        ),
      })
      .parse(response.json());
    expect(value).toMatchObject({
      text: "Look at this",
      images: [{ mimeType: "image/png", bytes: 24 }],
    });
    expect(value.images[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
    await server.close();
  });

  it("rejects a fifth file instead of silently truncating the command", async () => {
    const server = await multipartServer();
    const request = multipartBody(
      metadata,
      Array.from({ length: 5 }, (_, index) => ({
        name: `photo-${String(index)}.png`,
        contentType: "image/png",
        bytes: png(1, 1),
      })),
    );
    const response = await server.inject({
      method: "POST",
      url: "/chat",
      headers: {
        "content-type": `multipart/form-data; boundary=${request.boundary}`,
      },
      payload: request.body,
    });
    expect(response.statusCode).toBe(500);
    expect(
      z.object({ message: z.string() }).parse(response.json()).message,
    ).toBe("chat_image_limit_exceeded");
    await server.close();
  });

  it("accepts an image-only command but rejects a command with no text or image", async () => {
    const server = await multipartServer();
    const imageOnly = multipartBody({ ...metadata, prompt: "" }, [
      { name: "photo.png", contentType: "image/png", bytes: png(1, 1) },
    ]);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/chat",
          headers: {
            "content-type": `multipart/form-data; boundary=${imageOnly.boundary}`,
          },
          payload: imageOnly.body,
        })
      ).statusCode,
    ).toBe(200);

    const empty = multipartBody({ ...metadata, prompt: "" }, []);
    const response = await server.inject({
      method: "POST",
      url: "/chat",
      headers: {
        "content-type": `multipart/form-data; boundary=${empty.boundary}`,
      },
      payload: empty.body,
    });
    expect(response.statusCode).toBe(500);
    expect(
      z.object({ message: z.string() }).parse(response.json()).message,
    ).toBe("chat_input_empty");
    await server.close();
  });
});
