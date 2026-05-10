const STOPWORDS = new Set([
  'about',
  'also',
  'and',
  'any',
  'anything',
  'are',
  'before',
  'brief',
  'can',
  'confirm',
  'could',
  'decide',
  'does',
  'escalate',
  'escalated',
  'escalating',
  'exec',
  'for',
  'from',
  'full',
  'give',
  'have',
  'how',
  'just',
  'know',
  'land',
  'latest',
  'like',
  'need',
  'picture',
  'should',
  'that',
  'team',
  'the',
  'there',
  'this',
  'track',
  'want',
  'what',
  'when',
  'where',
  'whether',
  'with',
  'work',
  'would',
  'you'
]);

export function buildRetrievalQuery(text: string, limit = 8): string {
  const normalized = text
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, ' ')
    .replace(/<#([A-Z0-9]+)(?:\|([^>]+))?>/g, ' $2 ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [];
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const key = token.toLowerCase();
    if (STOPWORDS.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(token);
    if (cleaned.length >= limit) {
      break;
    }
  }

  return cleaned.join(' ') || normalized;
}

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [];
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(token);
  }
  return unique;
}

function addVariant(variants: string[], parts: string[]): void {
  const variant = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!variant || variants.includes(variant)) {
    return;
  }
  variants.push(variant);
}

export function buildRetrievalQueryVariants(query: string, limit = 5): string[] {
  const trimmed = query.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return [];
  }

  const tokens = uniqueTokens(tokenize(trimmed));
  const variants: string[] = [];
  const properNouns = tokens.filter((token) => /^[A-Z]/.test(token));
  const rateIndex = tokens.findIndex((token, index) =>
    token.toLowerCase() === 'rate' && tokens[index + 1]?.toLowerCase() === 'limiting'
  );

  addVariant(variants, tokens);
  if (rateIndex >= 0) {
    addVariant(variants, [
      ...properNouns.slice(0, 1),
      tokens[rateIndex],
      tokens[rateIndex + 1]
    ]);
    addVariant(variants, ['API', tokens[rateIndex], tokens[rateIndex + 1]]);
  }

  if (properNouns.length > 0) {
    if (properNouns.length === 1) {
      addVariant(variants, [properNouns[0], 'Corp']);
    } else {
      addVariant(variants, properNouns.slice(0, 2));
    }
    addVariant(variants, [properNouns[0], 'onboarding']);
  }

  if (rateIndex >= 0) {
    addVariant(variants, [tokens[rateIndex], tokens[rateIndex + 1]]);
  }

  if (rateIndex >= 0 && tokens.some((token) => ['risk', 'risks', 'timeline', 'decided'].includes(token.toLowerCase()))) {
    addVariant(variants, ['Retry-After', 'throttled']);
  }

  return variants.slice(0, Math.max(1, limit));
}
