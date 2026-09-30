import { HttpException } from '@nestjs/common';
import {
  ProviderPublishError,
  type ProviderErrorClass,
} from '../channels/ports/SocialPublisherPort.js';

export class LeaseLostError extends Error {
  constructor(
    readonly publicationId: number,
    readonly attemptId: number,
  ) {
    super(`Attempt ${attemptId} no longer owns publication ${publicationId}`);
    this.name = 'LeaseLostError';
  }
}

export type FailureDecision =
  | { kind: 'retry'; errorClass: ProviderErrorClass }
  | { kind: 'terminal'; errorClass: ProviderErrorClass }
  | {
      kind: 'unknown';
      errorClass: ProviderErrorClass;
      contractViolation: boolean;
    }
  | { kind: 'lease_lost' };

/** Spec §6.1: adapters declare semantics; the marker decides non-provider errors. */
export function decideFailure(
  error: unknown,
  markerSet: boolean,
): FailureDecision {
  if (error instanceof LeaseLostError) return { kind: 'lease_lost' };

  if (error instanceof ProviderPublishError) {
    if (error.outcomeUnknown) {
      return {
        kind: 'unknown',
        errorClass: error.errorClass,
        contractViolation: !markerSet,
      };
    }
    if (error.retryable) return { kind: 'retry', errorClass: error.errorClass };
    return { kind: 'terminal', errorClass: error.errorClass };
  }

  if (markerSet) {
    return {
      kind: 'unknown',
      errorClass: 'internal',
      contractViolation: false,
    };
  }
  if (
    error instanceof HttpException &&
    error.getStatus() >= 400 &&
    error.getStatus() < 500
  ) {
    return { kind: 'terminal', errorClass: 'invalid_request' };
  }
  return { kind: 'retry', errorClass: 'internal' };
}

export function failureMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1500,
  );
}
