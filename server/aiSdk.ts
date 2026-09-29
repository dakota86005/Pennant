/**
 * The AI providers' SDKs, loaded the first time one is used, never at the server's start (N6 polish).
 *
 * The three SDKs took about 140 ms of the sidecar's start on an M4 (the Anthropic, OpenAI and Google clients and
 * everything they pull in), time the Mac app waited before its first answer, for a feature that is optional (D-001:
 * the application works without a credential) and used long after the start if at all. Types still come from the
 * packages directly (`import type`), which costs nothing at run time.
 */
import type AnthropicClient from '@anthropic-ai/sdk';
import type OpenAIClient from 'openai';
import type { GoogleGenAI as GoogleGenAIClient } from '@google/genai';

export async function anthropicSdk(): Promise<typeof AnthropicClient> {
  return (await import('@anthropic-ai/sdk')).default;
}

export async function openAiSdk(): Promise<typeof OpenAIClient> {
  return (await import('openai')).default;
}

export async function googleGenAiSdk(): Promise<typeof GoogleGenAIClient> {
  return (await import('@google/genai')).GoogleGenAI;
}
