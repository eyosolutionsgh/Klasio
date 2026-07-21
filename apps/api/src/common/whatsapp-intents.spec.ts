import { describe, expect, it } from 'vitest';
import { classifyMessage, menuChoice, pickNumber } from './whatsapp-intents';

describe('classifyMessage', () => {
  it('recognises the set list the way parents actually type', () => {
    expect(classifyMessage('What do I owe?')).toBe('BALANCE');
    expect(classifyMessage('bal')).toBe('BALANCE');
    expect(classifyMessage('How much school fees')).toBe('BALANCE');
    expect(classifyMessage('did the results come out')).toBe('RESULTS');
    expect(classifyMessage('report card')).toBe('RESULTS');
    expect(classifyMessage('has ama been absent this term')).toBe('ATTENDANCE');
    expect(classifyMessage('Kofi is sick today')).toBe('REPORT_ABSENCE');
    expect(classifyMessage('my sister is collecting today')).toBe('PICKUP_CHANGE');
    expect(classifyMessage('when do you reopen')).toBe('NOTICES');
    expect(classifyMessage('I want to speak to someone')).toBe('HUMAN');
    expect(classifyMessage('Hello')).toBe('MENU');
  });

  it('a person asking for a person wins over every other keyword', () => {
    expect(classifyMessage('I want to talk to a person about the results')).toBe('HUMAN');
  });

  it('sickness wins over the attendance keyword it contains', () => {
    expect(classifyMessage('she is unwell and will be absent today')).toBe('REPORT_ABSENCE');
  });

  it('refuses to guess at anything off the list', () => {
    expect(classifyMessage('who won the match last night')).toBe('UNKNOWN');
    expect(classifyMessage('')).toBe('UNKNOWN');
  });
});

describe('pickNumber / menuChoice', () => {
  it('reads a bare number reply and refuses anything out of range', () => {
    expect(pickNumber('2', 3)).toBe(2);
    expect(pickNumber('2.', 3)).toBe(2);
    expect(pickNumber('9', 3)).toBeNull();
    expect(pickNumber('two', 3)).toBeNull();
  });

  it('maps the menu digits onto intents', () => {
    expect(menuChoice('1')).toBe('BALANCE');
    expect(menuChoice('7')).toBe('HUMAN');
    expect(menuChoice('8')).toBeNull();
  });
});
