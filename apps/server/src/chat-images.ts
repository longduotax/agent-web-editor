import { createHash } from "node:crypto";

import type { FastifyRequest } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import {
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MAX_SOURCE_BYTES,
  CHAT_IMAGE_MAX_TOTAL_SOURCE_BYTES,
  parseChatImageBytes,
} from "@pi-web/contracts";
import type {
  RuntimeImageInput,
  RuntimeUserInput,
} from "@pi-web/agent-runtime";
import { z } from "zod";

export const CHAT_MULTIPART_METADATA_FIELD = "metadata";
export const CHAT_MULTIPART_IMAGE_FIELD = "images";

const parsedChatInput = Symbol("parsedChatInput");

/** A chat command whose text and image bytes were parsed at a server boundary. */
export type ParsedChatInput = Readonly<RuntimeUserInput> & {
  readonly [parsedChatInput]: true;
};

interface ChatMetadata {
  prompt: string;
  idempotencyKey: string;
}

function malformed(code: string): Error {
  return new Error(code);
}

function trustedChatInput(
  text: string,
  images: readonly RuntimeImageInput[],
): ParsedChatInput {
  return {
    text,
    images: images.map((image) => ({
      mimeType: image.mimeType,
      data: new Uint8Array(image.data),
      digest: image.digest,
    })),
    [parsedChatInput]: true,
  };
}

/** Constructs the image-free value accepted after a strict JSON route parse. */
export function parseTextChatInput(prompt: string): ParsedChatInput {
  return trustedChatInput(prompt, []);
}

/** Parses image bytes when a server-owned caller needs a trusted test fixture. */
export function parseImageChatInput(
  text: string,
  sources: readonly Uint8Array[],
): ParsedChatInput {
  if (sources.length === 0 || sources.length > CHAT_IMAGE_MAX_COUNT)
    throw malformed("chat_image_count_exceeded");
  let totalBytes = 0;
  const images = sources.map((source) => {
    const bytes = Buffer.from(source);
    if (bytes.length === 0) throw malformed("chat_image_empty");
    if (bytes.length > CHAT_IMAGE_MAX_SOURCE_BYTES)
      throw malformed("chat_image_too_large");
    totalBytes += bytes.length;
    if (totalBytes > CHAT_IMAGE_MAX_TOTAL_SOURCE_BYTES)
      throw malformed("chat_image_total_too_large");
    const parsed = parseChatImageBytes(bytes);
    return {
      mimeType: parsed.mimeType,
      data: new Uint8Array(bytes),
      digest: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  return trustedChatInput(text, images);
}

export { parseChatImageBytes } from "@pi-web/contracts";

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
): Promise<{ metadata: z.output<Schema>; input: ParsedChatInput }> {
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
    input: trustedChatInput(metadata.data.prompt, images),
  };
}
