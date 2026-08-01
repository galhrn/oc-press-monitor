/**
 * The classification call (tasks P4.3, P4.5, decisions AD-06, AD-08, AD-09).
 *
 * One Ollama call per article returning relevance and sentiment together. Determinism,
 * retries, caching and concurrency all live in `@oc/ollama`; this module owns the contract
 * with the model and nothing else.
 */
import { ClassificationError, toError, type Logger } from '@oc/core';
import type { OllamaClient } from '@oc/ollama';
import {
  CLASSIFICATION_JSON_SCHEMA,
  RawClassificationSchema,
  RepairError,
  toClassification,
  type Classification,
} from './schema.js';
import {
  buildUserPrompt,
  loadClassifyPrompt,
  promptVersionTag,
  type ClassifyInput,
} from './prompt.js';

export interface ClassifyResult {
  classification: Classification;
  model: string;
  promptVersion: string;
  cached: boolean;
  durationMs: number;
}

export interface ClassifyOptions {
  client: OllamaClient;
  model?: string;
  logger?: Logger;
  promptPath?: string;
}

export async function classifyArticle(
  input: ClassifyInput,
  options: ClassifyOptions,
): Promise<ClassifyResult> {
  const { text } = loadClassifyPrompt(options.promptPath);
  const promptVersion = promptVersionTag(options.promptPath);

  const result = await options.client.generate({
    promptVersion,
    system: text,
    prompt: buildUserPrompt(input),
    schema: RawClassificationSchema,
    jsonSchema: CLASSIFICATION_JSON_SCHEMA,
    ...(options.model ? { model: options.model } : {}),
  });

  try {
    return {
      classification: toClassification(result.value),
      model: result.model,
      promptVersion: result.promptVersion,
      cached: result.cached,
      durationMs: result.durationMs,
    };
  } catch (thrown) {
    // A repair failure is a real failure, not a formatting quibble: the model contradicted
    // itself or named a sentiment that does not exist. Retrying a deterministic call would
    // produce the same answer, so it is surfaced rather than swallowed.
    const error = toError(thrown);
    options.logger?.warn(
      { company: input.company, err: error.message, raw: result.value },
      'classification could not be repaired into the schema',
    );
    throw new ClassificationError(`unrepairable classification: ${error.message}`, {
      retryable: false,
      cause: thrown instanceof RepairError ? thrown : undefined,
      context: { company: input.company, model: result.model, promptVersion },
    });
  }
}
