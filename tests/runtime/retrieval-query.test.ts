import { describe, expect, it } from 'vitest';
import { buildRetrievalQuery, buildRetrievalQueryVariants } from '#app/server/util/retrieval-query';

describe('buildRetrievalQuery', () => {
  it('strips Slack markup and keeps source-matching keywords', () => {
    expect(buildRetrievalQuery(
      '<@U0AU923Q3FE> are we on track to land the rate limiting work before the Acme deadline? Just want to know if there is anything blocking that I should escalate.'
    )).toBe('rate limiting Acme deadline blocking');
  });

  it('removes generic request intent from broad context requests', () => {
    const query = buildRetrievalQuery(
      '<@U0AU923Q3FE> can you give me the full picture on the Acme rate limiting work? I need to brief the exec team — timeline, what we decided, where we are, and any risks.'
    );

    expect(query).toBe('Acme rate limiting timeline decided risks');
    expect(buildRetrievalQueryVariants(query, 5)).toEqual([
      'Acme rate limiting timeline decided risks',
      'Acme rate limiting',
      'API rate limiting',
      'Acme Corp',
      'Acme onboarding'
    ]);
  });
});
