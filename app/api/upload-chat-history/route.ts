import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { upsertChunksAndEmbed, windowMessagesIntoChunks } from "@/lib/rag";
import { parseChatDate } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Creator {
  name: string;
  email: string;
  user_type: string;
}

interface ChatMessage {
  creator: Creator;
  created_date: string | null;
  text: string;
  topic_id: string;
  message_id: string;
}

export async function POST(request: NextRequest) {
  try {
    console.log("[v0] Starting file upload process");

    if (!process.env.OPENAI_API_KEY) {
      console.error("[v0] Missing OPENAI_API_KEY environment variable");
      return NextResponse.json(
        {
          error: "Server configuration error: Missing OpenAI API key",
        },
        { status: 500 }
      );
    }

    console.log("[v0] Parsing form data");
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const filename = formData.get("filename") as string;

    if (!file) {
      console.log("[v0] No file provided in request");
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    console.log("[v0] File received:", file.name, "Size:", file.size);

    // Get user from session
    console.log("[v0] Creating Supabase client");
    const supabase = await createClient();

    console.log("[v0] Getting user from session");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[v0] Auth error:", userError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[v0] User authenticated:", user.id);

    // Read and parse the JSON file
    console.log("[v0] Reading file content");
    const fileContent = await file.text();
    let chatData: Record<string, unknown>;

    try {
      console.log("[v0] Parsing JSON content, length:", fileContent.length);
      chatData = JSON.parse(fileContent);
    } catch (parseError) {
      console.error("[v0] JSON parse error:", parseError);
      return NextResponse.json({ error: "Invalid JSON file" }, { status: 400 });
    }

    // Proactively strip heavy fields like annotations before processing
    stripAnnotations(chatData);

    // Process the chat data - handle different JSON structures

    const messages = extractMessagesFromJSON(chatData);

    if (messages.length === 0) {
      console.log("[v0] No messages found in file");
      return NextResponse.json(
        { error: "No messages found in the file" },
        { status: 400 }
      );
    }

    console.log("[v0] Testing database connection");
    try {
      const { error: testError } = await supabase
        .from("chat_chunks")
        .select("count")
        .limit(1);

      if (testError) {
        console.error("[v0] Database connection test failed:", testError);
        return NextResponse.json(
          {
            error: `Database connection failed: ${testError.message}`,
          },
          { status: 500 }
        );
      }
      console.log("[v0] Database connection successful");
    } catch (dbError) {
      console.error("[v0] Database connection error:", dbError);
      return NextResponse.json(
        {
          error: `Database error: ${
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error"
          }`,
        },
        { status: 500 }
      );
    }

    // New: window messages into chunks and upsert/embed
    console.log("[v0] Windowing messages into chunks (with trivial filtering)");
    const normalized = messages.map((m) => ({
      content: m.text,
      timestamp: m.created_date,
      participant: m.creator.name,
      email: m.creator.email,
    }));
    const chunks = windowMessagesIntoChunks(normalized);

    console.log("[v0] Upserting chunks and embedding missing ones");
    const { inserted, embedded } = await upsertChunksAndEmbed(
      user.id,
      chunks,
      filename || file.name
    );

    console.log("[v0] File processing completed successfully");
    return NextResponse.json({
      success: true,
      chunks_generated: chunks.length,
      chunks_inserted: inserted,
      chunks_embedded: embedded,
      total_messages: messages.length,
      message: "Chunked ingest complete",
    });
  } catch (error) {
    console.error("[v0] Error uploading chat history:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      {
        error: `Failed to process chat history: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}

function stripAnnotations(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) stripAnnotations(item);
    return;
  }
  const record = obj as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "annotations")) {
    delete record["annotations"];
  }
  for (const key of Object.keys(record)) {
    stripAnnotations(record[key]);
  }
}

function extractMessagesFromJSON(data: Record<string, unknown>): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Handle the specific structure with messages array
  if (data.messages && Array.isArray(data.messages)) {
    data.messages.forEach((item: Record<string, unknown>, index: number) => {
      const message = normalizeMessage(item, index);
      if (message) messages.push(message);
    });
  } else if (Array.isArray(data)) {
    // Direct array of messages
    data.forEach((item, index) => {
      const message = normalizeMessage(item, index);
      if (message) messages.push(message);
    });
  } else if (data.conversations && Array.isArray(data.conversations)) {
    // Object with conversations array
    data.conversations.forEach((conv: Record<string, unknown>) => {
      if (conv.messages && Array.isArray(conv.messages)) {
        conv.messages.forEach(
          (item: Record<string, unknown>, index: number) => {
            const message = normalizeMessage(item, index);
            if (message) messages.push(message);
          }
        );
      }
    });
  } else {
    // Try to extract from any nested structure
    const extracted = extractFromNestedObject(data);
    messages.push(...extracted);
  }

  return messages.filter((msg) => msg.text && msg.text.trim().length > 0);
}

function normalizeMessage(
  item: Record<string, unknown>,
  index: number
): ChatMessage | null {
  if (!item || typeof item !== "object") return null;

  // Check if this is the new structure with creator object
  if (item.creator && item.text && item.topic_id && item.message_id) {
    const creator = item.creator as Record<string, unknown>;
    return {
      creator: {
        name: (creator.name as string) || "Unknown",
        email: (creator.email as string) || "",
        user_type: (creator.user_type as string) || "Human",
      },
      created_date: parseChatDate(item.created_date as string),
      text: item.text as string,
      topic_id: item.topic_id as string,
      message_id: item.message_id as string,
    };
  }

  // Fallback for other structures
  const content =
    item.content ||
    item.message ||
    item.text ||
    item.body ||
    item.msg ||
    (typeof item === "string" ? item : null);
  if (!content) return null;

  const participant =
    item.participant ||
    item.sender ||
    item.author ||
    item.from ||
    item.user ||
    item.name ||
    item.username ||
    "Unknown";
  const timestamp =
    item.timestamp ||
    item.date ||
    item.time ||
    item.created_at ||
    item.sent_at ||
    item.datetime ||
    null;

  return {
    creator: {
      name: String(participant),
      email: "",
      user_type: "Human",
    },
    created_date: timestamp ? String(timestamp) : null,
    text: String(content),
    topic_id: (item.topic_id as string) || `topic_${index}`,
    message_id: (item.message_id as string) || `msg_${index}`,
  };
}

function extractFromNestedObject(
  obj: Record<string, unknown>,
  messages: ChatMessage[] = []
): ChatMessage[] {
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const message = normalizeMessage(item, index);
      if (message) messages.push(message);
      else if (typeof item === "object") {
        extractFromNestedObject(item as Record<string, unknown>, messages);
      }
    });
  } else if (obj && typeof obj === "object") {
    Object.values(obj).forEach((value) => {
      if (Array.isArray(value)) {
        extractFromNestedObject(
          value as unknown as Record<string, unknown>,
          messages
        );
      } else if (value && typeof value === "object") {
        extractFromNestedObject(value as Record<string, unknown>, messages);
      }
    });
  }

  return messages;
}
