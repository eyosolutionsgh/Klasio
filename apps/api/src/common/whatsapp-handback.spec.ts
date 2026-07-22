import { describe, expect, it } from 'vitest';
import { parseHandback } from './whatsapp-handback';

/**
 * The two ways this can be wrong are opposites, and both are bad: a command that fails to wake the
 * assistant leaves a family on a human forever, and a phrase mistaken for a command wakes it in
 * the middle of a live conversation the school is still handling.
 */
describe('handing a thread back to the assistant', () => {
  it('takes the command alone', () => {
    expect(parseHandback('/bot')).toEqual({ handBack: true, message: '' });
    expect(parseHandback('  /BOT  ')).toEqual({ handBack: true, message: '' });
    expect(parseHandback('back to the assistant')).toEqual({ handBack: true, message: '' });
  });

  it('sends what was written and then hands back', () => {
    // The ordinary case: answer the question, and let the assistant have the thread again.
    expect(parseHandback('The PTA meets Friday at 3pm. /bot')).toEqual({
      handBack: true,
      // The school's own full stop survives: removing the command must not edit their sentence.
      message: 'The PTA meets Friday at 3pm.',
    });
    expect(parseHandback('/bot Thanks for waiting — sorted now.')).toEqual({
      handBack: true,
      message: 'Thanks for waiting — sorted now.',
    });
  });

  it('ignores the words used in passing', () => {
    // Somebody explaining the assistant must not accidentally summon it mid-conversation.
    expect(parseHandback('I will ask the bot to send it to you')).toEqual({
      handBack: false,
      message: 'I will ask the bot to send it to you',
    });
    expect(parseHandback('Our assistant takes over at night, so write any time')).toEqual({
      handBack: false,
      message: 'Our assistant takes over at night, so write any time',
    });
  });

  it('does not swallow a sentence that merely starts with the words', () => {
    // "assistant take over" is a command; "assistant take over from here" is a person talking.
    const said = 'assistant take overs are not a thing';
    expect(parseHandback(said).handBack).toBe(false);
  });

  it('leaves an ordinary reply completely alone', () => {
    expect(parseHandback('Good morning, we open at 7am.')).toEqual({
      handBack: false,
      message: 'Good morning, we open at 7am.',
    });
    expect(parseHandback('')).toEqual({ handBack: false, message: '' });
  });
});
