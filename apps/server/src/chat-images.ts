import { createHash } from "node:crypto";

import type { FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import {
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MAX_PIXELS,
  CHAT_IMAGE_MAX_SOURCE_BYTES,
  CHAT_IMAGE_MAX_TOTAL_SOURCE_BYTES,
  ChatImageMimeTypeSchema,
  type ChatImageMimeType,
} from "@pi-web/contracts";
import type {
  RuntimeImageInput,
  RuntimeUserInput,
} from "@pi-web/agent-runtime";
import { z } from "zod";

export const CHAT_MULTIPART_METADATA_FIELD = "metadata";
export const CHAT_MULTIPART_IMAGE_FIELD = "images";

interface ChatMetadata {
  prompt: string;
  idempotencyKey: string;
}

function malformed(code: string): Error {
  return new Error(code);
}

function uint24le(bytes: Buffer, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function pngDimensions(
  bytes: Buffer,
): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  )
    return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): {
  width: number;
  height: number;
} | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (length < 7) return null;
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): {
  width: number;
  height: number;
} | null {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  )
    return null;
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X")
    return {
      width: uint24le(bytes, 24) + 1,
      height: uint24le(bytes, 27) + 1,
    };
  if (chunk === "VP8 ") {
    if (
      bytes.length < 30 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    )
      return null;
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const b1 = bytes[21] ?? 0;
    const b2 = bytes[22] ?? 0;
    const b3 = bytes[23] ?? 0;
    const b4 = bytes[24] ?? 0;
    return {
      width: 1 + ((b1 | (b2 << 8)) & 0x3fff),
      height: 1 + (((b2 >> 6) | (b3 << 2) | (b4 << 10)) & 0x3fff),
    };
  }
  return null;
}

export function parseChatImageBytes(bytes: Buffer): {
  mimeType: ChatImageMimeType;
  width: number;
  height: number;
} {
  const candidates: {
    mimeType: ChatImageMimeType;
    dimensions: { width: number; height: number } | null;
  }[] = [
    { mimeType: "image/png", dimensions: pngDimensions(bytes) },
    { mimeType: "image/jpeg", dimensions: jpegDimensions(bytes) },
    { mimeType: "image/webp", dimensions: webpDimensions(bytes) },
  ];
  const found = candidates.find((candidate) => candidate.dimensions !== null);
  if (found?.dimensions === null || found === undefined)
    throw malformed("chat_image_unsupported");
  const { width, height } = found.dimensions;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw malformed("chat_image_malformed");
  if (width * height > CHAT_IMAGE_MAX_PIXELS)
    throw malformed("chat_image_pixels_exceeded");
  return {
    mimeType: ChatImageMimeTypeSchema.parse(found.mimeType),
    width,
    height,
  };
}

async function imageFromPart(part: MultipartFile): Promise<RuntimeImageInput> {
  if (part.fieldname !== CHAT_MULTIPART_IMAGE_FIELD)
    throw malformed("chat_image_part_invalid");
  if (part.filename.length > 255) throw malformed("chat_image_name_too_long");
  let bytes: Buffer;
  try {
    bytes = await part.toBuffer();
  } catch (error) {
    throw malformed(
      error instanceof Error && /limit|large|size/i.test(error.message)
        ? "chat_image_too_large"
        : "chat_image_malformed",
    );
  }
  if (bytes.length === 0) throw malformed("chat_image_empty");
  if (bytes.length > CHAT_IMAGE_MAX_SOURCE_BYTES)
    throw malformed("chat_image_too_large");
  const parsed = parseChatImageBytes(bytes);
  return {
    mimeType: parsed.mimeType,
    data: new Uint8Array(bytes),
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function parseMultipartChatInput<
  Schema extends z.ZodType<ChatMetadata>,
>(
  request: FastifyRequest,
  metadataSchema: Schema,
): Promise<{ metadata: z.output<Schema>; input: RuntimeUserInput }> {
  let metadataText: string | null = null;
  const images: RuntimeImageInput[] = [];
  let totalBytes = 0;
  try {
    for await (const part of request.parts({
      limits: {
        fields: 1,
        files: CHAT_IMAGE_MAX_COUNT,
        parts: CHAT_IMAGE_MAX_COUNT + 1,
        fieldSize: 1_048_576,
        fileSize: CHAT_IMAGE_MAX_SOURCE_BYTES,
      },
    })) {
      if (part.type === "field") {
        if (
          part.fieldname !== CHAT_MULTIPART_METADATA_FIELD ||
          metadataText !== null ||
          typeof part.value !== "string"
        )
          throw malformed("chat_metadata_invalid");
        metadataText = part.value;
        continue;
      }
      if (images.length >= CHAT_IMAGE_MAX_COUNT)
        throw malformed("chat_image_count_exceeded");
      const image = await imageFromPart(part);
      totalBytes += image.data.byteLength;
      if (totalBytes > CHAT_IMAGE_MAX_TOTAL_SOURCE_BYTES)
        throw malformed("chat_image_total_too_large");
      images.push(image);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("chat_"))
      throw error;
    throw malformed(
      error instanceof Error &&
        /limit|large|size|parts|files/i.test(error.message)
        ? "chat_image_limit_exceeded"
        : "chat_multipart_malformed",
    );
  }
  if (metadataText === null) throw malformed("chat_metadata_missing");
  let rawMetadata: unknown;
  try {
    rawMetadata = JSON.parse(metadataText);
  } catch {
    throw malformed("chat_metadata_invalid");
  }
  const metadata = metadataSchema.safeParse(rawMetadata);
  if (!metadata.success) throw malformed("chat_metadata_invalid");
  if (metadata.data.prompt === "" && images.length === 0)
    throw malformed("chat_input_empty");
  return {
    metadata: metadata.data,
    input: { text: metadata.data.prompt, images },
  };
}
