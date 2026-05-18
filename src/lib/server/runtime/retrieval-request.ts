import type { AgentToolInventoryItem, ContextAssembly, ToolRetrievalProfile } from '#lib/types';
import { buildRetrievalQuery, buildRetrievalQueryVariants } from '#lib/server/util/retrieval-query';

export interface NormalizedRetrievalRequest {
  rawText: string;
  intentQuery: string;
  sourceTerms: string[];
  entityTerms: string[];
  candidateQueries: string[];
}

const FALLBACK_SEARCH_PROFILES: Record<string, ToolRetrievalProfile> = {
  'notion.search': 'title_keywords',
  'linear_search_issues': 'work_item',
  'linear.search_issues': 'work_item',
  'github.search': 'code_review',
  'gmail.search': 'email_thread',
  'slack.search': 'team_discussion',
  'granola.search': 'team_discussion',
  'discord.search': 'team_discussion'
};

function addUnique(values: string[], value: string | undefined): void {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return;
  }

  const key = normalized.toLowerCase();
  if (values.some((existing) => existing.toLowerCase() === key)) {
    return;
  }

  values.push(normalized);
}

function collectText(context: ContextAssembly): { rawText: string; sourceTitles: string[]; sourceText: string } {
  const threadText = [
    context.thread.latestMessage,
    ...context.thread.recentMessages.map((message) => message.text)
  ].filter(Boolean).join('\n');
  const sourceTitles: string[] = [];
  const sourceParts: string[] = [];

  for (const artifact of context.artifacts) {
    addUnique(sourceTitles, artifact.title);
    sourceParts.push(artifact.title, artifact.text);
  }

  if (context.sessionContext?.handoffDoc) {
    addUnique(sourceTitles, context.sessionContext.handoffDoc.title);
    sourceParts.push(context.sessionContext.handoffDoc.title, context.sessionContext.handoffDoc.text);
  }

  for (const section of context.sessionContext?.sections ?? []) {
    addUnique(sourceTitles, section.title);
    sourceParts.push(section.title, section.summary);
  }

  const sourceText = sourceParts.filter(Boolean).join('\n');
  return {
    rawText: [threadText, sourceText].filter(Boolean).join('\n'),
    sourceTitles,
    sourceText
  };
}

function releaseTerms(text: string): string[] {
  const terms: string[] = [];
  const versionMatches = text.match(/\bv\d+(?:\.\d+){1,2}\b/gi) ?? [];
  const mentionsMurph = /\bmurph\b/i.test(text);

  for (const version of versionMatches) {
    addUnique(terms, mentionsMurph ? `Murph ${version}` : version);
  }

  return terms;
}

function entityTerms(text: string): string[] {
  const terms: string[] = [];
  for (const pattern of [/\bMUR-\d+\b/gi, /\bF\d+\b/g, /#\d+\b/g]) {
    for (const match of text.match(pattern) ?? []) {
      addUnique(terms, match);
    }
  }
  for (const release of releaseTerms(text)) {
    addUnique(terms, release);
  }
  if (/\[TEST\]/i.test(text)) {
    addUnique(terms, '[TEST]');
  }
  return terms;
}

function titleMatchesReleaseOrTest(title: string, releases: string[], hasTestPrefix: boolean): boolean {
  const lowerTitle = title.toLowerCase();
  return (hasTestPrefix && lowerTitle.includes('[test]')) ||
    releases.some((release) => lowerTitle.includes(release.toLowerCase()));
}

export function buildNormalizedRetrievalRequest(context: ContextAssembly): NormalizedRetrievalRequest {
  const { rawText, sourceTitles, sourceText } = collectText(context);
  const threadText = context.thread.latestMessage ||
    context.thread.recentMessages.map((message) => message.text).join(' ');
  const intentQuery = buildRetrievalQuery(threadText || rawText);
  const combinedText = [rawText, sourceText].filter(Boolean).join('\n');
  const entities = entityTerms(combinedText);
  const releases = entities.filter((term) => /\bv\d+(?:\.\d+){1,2}\b/i.test(term));
  const hasTestPrefix = entities.some((term) => term.toLowerCase() === '[test]');
  const sourceTerms: string[] = [];
  const candidateQueries: string[] = [];

  for (const title of sourceTitles) {
    if (titleMatchesReleaseOrTest(title, releases, hasTestPrefix)) {
      addUnique(sourceTerms, title);
    }
  }
  for (const title of sourceTitles) {
    if (sourceTerms.length >= 6) {
      break;
    }
    if (title.length <= 100) {
      addUnique(sourceTerms, title);
    }
  }

  for (const term of sourceTerms) {
    addUnique(candidateQueries, term);
  }
  for (const release of releases) {
    if (hasTestPrefix) {
      addUnique(candidateQueries, `[TEST] ${release}`);
    }
    addUnique(candidateQueries, release);
  }
  for (const entity of entities) {
    addUnique(candidateQueries, entity);
  }
  for (const variant of buildRetrievalQueryVariants(intentQuery, 3)) {
    addUnique(candidateQueries, variant);
  }
  addUnique(candidateQueries, intentQuery);

  return {
    rawText,
    intentQuery,
    sourceTerms,
    entityTerms: entities,
    candidateQueries
  };
}

function firstMatching(candidates: string[], predicate: (candidate: string) => boolean): string | undefined {
  return candidates.find(predicate);
}

export function retrievalQueryForTool(
  tool: Pick<AgentToolInventoryItem, 'name' | 'retrieval'>,
  request: NormalizedRetrievalRequest
): string {
  const profile = tool.retrieval?.profile ?? FALLBACK_SEARCH_PROFILES[tool.name] ?? 'generic';
  const candidates = request.candidateQueries;
  const release = firstMatching(request.entityTerms, (candidate) => /\bmurph\s+v\d/i.test(candidate)) ||
    firstMatching(request.entityTerms, (candidate) => /\bv\d+(?:\.\d+){1,2}\b/i.test(candidate));

  if (profile === 'title_keywords') {
    return firstMatching(request.sourceTerms, (candidate) => candidate.includes('[TEST]')) ||
      firstMatching(request.sourceTerms, (candidate) => /\bv\d/i.test(candidate)) ||
      request.sourceTerms[0] ||
      release ||
      request.intentQuery;
  }

  if (profile === 'work_item') {
    return release ||
      firstMatching(candidates, (candidate) => /\bMUR-\d+\b/i.test(candidate)) ||
      firstMatching(candidates, (candidate) => /\bF\d+\b/.test(candidate)) ||
      request.intentQuery;
  }

  if (profile === 'code_review' || profile === 'email_thread' || profile === 'team_discussion') {
    return release || candidates[0] || request.intentQuery;
  }

  return candidates[0] || request.intentQuery;
}

export function deterministicRetrievalInputForTool(
  tool: AgentToolInventoryItem,
  request: NormalizedRetrievalRequest
): Record<string, unknown> | undefined {
  const schema = tool.inputSchema ?? {};
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : [];
  const hasQuery = Object.prototype.hasOwnProperty.call(properties, 'query');

  if (!hasQuery) {
    return undefined;
  }

  if (required.some((name) => name !== 'query')) {
    return undefined;
  }

  return {
    query: retrievalQueryForTool(tool, request),
    limit: 5
  };
}
