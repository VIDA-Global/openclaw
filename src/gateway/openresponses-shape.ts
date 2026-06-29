// OpenResponses output item factories.
// Keeps assistant/function-call output assembly in schema-compatible shapes.
import type { OutputItem } from "./open-responses.schema.js";

// Small OpenResponses output factories keep streamed assistant/function-call
// items in the exact schema shape expected by response assembly and tests.
/** Creates an assistant output message item for OpenResponses-compatible responses. */
export function createAssistantOutputItem(params: {
  id: string;
  text: string;
  phase?: "commentary" | "final_answer";
  status?: "in_progress" | "completed";
}): OutputItem {
  return {
    type: "message",
    id: params.id,
    role: "assistant",
    content: [{ type: "output_text", text: params.text }],
    ...(params.phase ? { phase: params.phase } : {}),
    status: params.status,
  };
}

/** Creates a function-call output item for OpenResponses-compatible responses. */
export function createFunctionCallOutputItem(params: {
  id: string;
  callId: string;
  name: string;
  arguments: string;
  status?: "in_progress" | "completed";
}): OutputItem {
  return {
    type: "function_call",
    id: params.id,
    call_id: params.callId,
    name: params.name,
    arguments: params.arguments,
    status: params.status,
  };
}

/** Creates a function-call-result item for OpenResponses-compatible responses. */
export function createFunctionCallResultOutputItem(params: {
  id: string;
  callId: string;
  output: string;
  status?: "in_progress" | "completed";
}): OutputItem {
  return {
    type: "function_call_output",
    id: params.id,
    call_id: params.callId,
    output: params.output,
    status: params.status,
  };
}

/** Creates a reasoning output item for OpenResponses-compatible responses. */
export function createReasoningOutputItem(params: {
  id: string;
  content?: string;
  summary?: string;
}): OutputItem {
  return {
    type: "reasoning",
    id: params.id,
    ...(params.content ? { content: params.content } : {}),
    ...(params.summary ? { summary: params.summary } : {}),
  };
}
