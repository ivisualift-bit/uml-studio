import { describe, expect, it } from 'vitest';
import { isCollectionMultiplicity, parseMultiplicity } from '@/domain/notation/multiplicity';
import {
  formatAttribute,
  formatOperation,
  parseAttributeText,
  parseOperationText,
  splitTopLevel,
} from '@/domain/notation/members';
import { formatTransitionLabel, parseGuard, parseMessageLabel, parseTransitionLabel } from '@/domain/notation/labels';
import { makeAttribute, makeOperation, makeParameter } from '@/domain/model/factory';

describe('multiplicity', () => {
  it.each([
    ['', true, ''],
    ['1', true, '1'],
    ['*', true, '*'],
    ['0..1', true, '0..1'],
    [' 1 .. * ', true, '1..*'],
    ['2..5', true, '2..5'],
    ['5..2', false, ''],
    ['a..b', false, ''],
    ['1..', false, ''],
    ['-1', false, ''],
  ])('parses %j', (input, ok, normalized) => {
    const result = parseMultiplicity(input);
    expect(result.ok).toBe(ok);
    if (result.ok) expect(result.normalized).toBe(normalized);
  });
  it('detects collections', () => {
    expect(isCollectionMultiplicity('0..*')).toBe(true);
    expect(isCollectionMultiplicity('1')).toBe(false);
    expect(isCollectionMultiplicity('0..1')).toBe(false);
    expect(isCollectionMultiplicity('2..3')).toBe(true);
  });
});

describe('feature notation', () => {
  it('formats attributes in UML syntax', () => {
    const a = makeAttribute({ id: 'a', name: 'items', type: 'Item', visibility: 'private', multiplicity: '0..*', isReadOnly: true });
    expect(formatAttribute(a)).toBe('- items: Item [0..*] {readOnly}');
    expect(formatAttribute(makeAttribute({ id: 'b', name: 'age', type: 'Integer', isDerived: true, defaultValue: '0', visibility: 'protected' }))).toBe('# /age: Integer = 0');
  });

  it('formats operations with parameters', () => {
    const op = makeOperation({
      id: 'o',
      name: 'enroll',
      returnType: 'void',
      parameters: [makeParameter({ id: 'p', name: 'course', type: 'Course' }), makeParameter({ id: 'q', name: 'out', type: 'Receipt', direction: 'out' })],
    });
    expect(formatOperation(op)).toBe('+ enroll(course: Course, out out: Receipt): void');
    expect(formatOperation(op, { showVisibility: false, showTypes: true, showSignature: false })).toBe('enroll(…): void');
  });

  it('parses attribute text', () => {
    expect(parseAttributeText('- name: String [0..1] = "x" {readOnly}')).toMatchObject({
      visibility: 'private',
      name: 'name',
      type: 'String',
      multiplicity: '0..1',
      defaultValue: '"x"',
      isReadOnly: true,
    });
    expect(parseAttributeText('static count: int')).toMatchObject({ isStatic: true, name: 'count', type: 'int' });
    expect(parseAttributeText('+ map: Map<String, List<Integer>>')).toMatchObject({ type: 'Map<String, List<Integer>>' });
    expect(parseAttributeText('two words')).toBeNull();
    expect(parseAttributeText('x [9..1]')).toBeNull();
  });

  it('parses operation text including generics and directions', () => {
    expect(parseOperationText('+ put(key: K, value: Map<K, V>): Boolean {query}')).toMatchObject({
      name: 'put',
      returnType: 'Boolean',
      isQuery: true,
      parameters: [
        { name: 'key', type: 'K', direction: 'in' },
        { name: 'value', type: 'Map<K, V>' },
      ],
    });
    expect(parseOperationText('- reset()')).toMatchObject({ name: 'reset', visibility: 'private', parameters: [] });
    expect(parseOperationText('total: Money')).toMatchObject({ name: 'total', returnType: 'Money' });
    expect(parseOperationText('broken(')).toBeNull();
  });

  it('splits at top level only', () => {
    expect(splitTopLevel('a: Map<K, V>, b: T', ',')).toEqual(['a: Map<K, V>', ' b: T']);
  });
});

describe('behaviour labels', () => {
  it('formats and parses transition labels', () => {
    const label = { trigger: 'publish', guard: 'approved', effect: 'notifySubscribers' };
    expect(formatTransitionLabel(label)).toBe('publish [approved] / notifySubscribers');
    expect(parseTransitionLabel('publish [approved] / notifySubscribers')).toEqual(label);
    expect(parseTransitionLabel('[x > 0]')).toEqual({ trigger: '', guard: 'x > 0', effect: '' });
    expect(parseTransitionLabel('/ log')).toEqual({ trigger: '', guard: '', effect: 'log' });
    expect(parseTransitionLabel('[a[0] == 1] / f()')).toEqual({ trigger: '', guard: 'a[0] == 1', effect: 'f()' });
    expect(formatTransitionLabel({ trigger: '', guard: '', effect: 'e' })).toBe('/ e');
  });
  it('parses guards and message labels', () => {
    expect(parseGuard('[valid]')).toBe('valid');
    expect(parseGuard('valid')).toBe('valid');
    expect(parseMessageLabel('login(user, pwd)')).toEqual({ name: 'login', arguments: 'user, pwd' });
    expect(parseMessageLabel('ok')).toEqual({ name: 'ok', arguments: '' });
  });
});
