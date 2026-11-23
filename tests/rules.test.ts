import { describe, expect, it } from 'vitest';
import { RULES_RELATIVE_PATH, assistantRulesBlock, loadAssistantRules, rulesFileExists } from '@/lib/ai/rules';
import { sanitizeReplyText } from '@/lib/domain/text';

describe('owner assistant rules file', () => {
  it('exists at the documented path', () => {
    expect(rulesFileExists()).toBe(true);
    expect(RULES_RELATIVE_PATH).toBe('docs/pravila-asistenta.md');
  });

  it('is loaded and keeps the signature rule', () => {
    const rules = loadAssistantRules();
    expect(rules.length).toBeGreaterThan(200);
    expect(rules.toLowerCase()).toContain('žig');
    expect(rules.toLowerCase()).toContain('potpis');
  });

  it('describes offering in-stock alternatives instead of guessing', () => {
    const rules = loadAssistantRules().toLowerCase();
    expect(rules).toContain('ormaric');
    expect(rules).toContain('na stanju');
  });

  it('strips HTML comments so editor notes never reach the model', () => {
    expect(loadAssistantRules()).not.toContain('Kako se koristi');
  });

  it('wraps the rules in a prompt block', () => {
    const block = assistantRulesBlock();
    expect(block).toContain('PRAVILA VLASNIKA');
    expect(block).toContain('žig');
  });
});

describe('customer message cleanup', () => {
  it('strips markdown emphasis and keeps sentence case', async () => {
    expect(sanitizeReplyText('**ALLIN FITNESS** košta 650 KM.')).toBe('ALLIN FITNESS košta 650 KM.');
    expect(sanitizeReplyText('poruka kupcu: zdravo.')).toBe('Zdravo.');
  });
});

describe('assistant turn splitting', () => {
  it('separates the internal explanation from the customer message', async () => {
    const { splitAssistantTurn } = await import('@/lib/domain/text');
    const { internal, customer } = splitAssistantTurn(
      'Našao sam proizvod, 650 KM.\n---PORUKA KUPcu---\nPoštovani, imamo ga na stanju.',
    );
    expect(internal).toContain('Našao sam');
    expect(customer).toBe('Poštovani, imamo ga na stanju.');
  });

  it('treats a plain customer-style answer as a customer message', async () => {
    const { splitAssistantTurn } = await import('@/lib/domain/text');
    const { internal, customer } = splitAssistantTurn('Poštovani, cijena je 650 KM.');
    expect(internal).toBe('');
    expect(customer).toContain('650 KM');
  });

  it('keeps everything as internal when there is no customer part', async () => {
    const { splitAssistantTurn } = await import('@/lib/domain/text');
    const { internal, customer } = splitAssistantTurn('Moram provjeriti dostupnost prije odgovora.');
    expect(customer).toBe('');
    expect(internal).toContain('provjeriti');
  });
});

describe('marker tolerance', () => {
  it('accepts different casing and missing trailing dashes', async () => {
    const { splitAssistantTurn } = await import('@/lib/domain/text');
    const { internal, customer } = splitAssistantTurn('Nalaz: 650 KM.\n---PORUKA KUPCU--\nPoštovani, dostupno je.');
    expect(internal).toContain('Nalaz');
    expect(customer).toBe('Poštovani, dostupno je.');
  });
});

describe('source lines are internal', () => {
  it('drops "Izvor: ..." from the customer block', async () => {
    const { splitAssistantTurn } = await import('@/lib/domain/text');
    const { internal, customer } = splitAssistantTurn(
      'Nalaz: 650 KM.\n---PORUKA KUPcu---\nPoštovani, košta 650 KM.\n\nS poštovanjem,\nGIGA.ba\n\nIzvor: katalog, provjereno 20.11.',
    );
    expect(internal).toContain('Nalaz');
    expect(customer).not.toContain('Izvor');
    expect(customer).toContain('S poštovanjem');
  });
});

describe('compiled rules block', () => {
  it('turns the markdown into short numbered lines', async () => {
    const { compileRules, assistantRulesBlock } = await import('@/lib/ai/rules');
    const rules = compileRules(loadAssistantRules());
    expect(rules.length).toBeGreaterThanOrEqual(9);
    expect(rules[0]?.id).toBe('R1');
    expect(rules.every((r) => r.title.length > 3)).toBe(true);
    const block = assistantRulesBlock();
    expect(block).toContain('R2 — ');
    expect(block).toContain('žig');
    expect(block).not.toContain('Kako se dodaje');
  });
});
