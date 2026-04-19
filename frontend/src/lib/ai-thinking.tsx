import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Shimmer } from '@/components/ai-elements/shimmer';

/**
 * Builds a translated `getThinkingMessage` callback for the AI SDK Reasoning
 * component. Returns a shimmer while streaming, then a fixed translated label
 * with the elapsed seconds. Plug into <ReasoningTrigger getThinkingMessage={...} />.
 */
export function makeThinkingMessage(t: TFunction) {
  return (isStreaming: boolean, duration?: number): ReactNode => {
    if (isStreaming || duration === 0) {
      return (
        <Shimmer duration={1}>
          {t('aiChat.thinkingShort', { defaultValue: 'Thinking…' })}
        </Shimmer>
      );
    }
    if (duration === undefined) {
      return <span>{t('aiChat.thoughtForFew', { defaultValue: 'Thought for a few seconds' })}</span>;
    }
    return (
      <span>
        {t('aiChat.thoughtFor', {
          seconds: duration,
          defaultValue: `Thought for ${duration}s`,
        })}
      </span>
    );
  };
}
