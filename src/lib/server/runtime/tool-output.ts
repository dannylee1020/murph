export const MAX_TOOL_RESULT_CHARS = 4000;

export function truncateToolOutput(output: unknown): unknown {
  const serialized = JSON.stringify(output);

  if (serialized.length <= MAX_TOOL_RESULT_CHARS) {
    return output;
  }

  return {
    truncated: true,
    text: serialized.slice(0, MAX_TOOL_RESULT_CHARS)
  };
}

export function outputSummary(output: unknown): Record<string, unknown> {
  if (Array.isArray(output)) {
    return {
      resultCount: output.length,
      titles: output
        .slice(0, 3)
        .map((entry) => entry && typeof entry === 'object' && 'title' in entry ? String(entry.title) : undefined)
        .filter(Boolean)
    };
  }

  if (output && typeof output === 'object') {
    if ('results' in output && Array.isArray(output.results)) {
      return {
        resultCount: output.results.length,
        titles: output.results
          .slice(0, 3)
          .map((entry) => entry && typeof entry === 'object' && 'title' in entry ? String(entry.title) : undefined)
          .filter(Boolean),
        strategy: 'strategy' in output ? String(output.strategy) : undefined,
        scannedAllowedPageCount:
          'scannedAllowedPageCount' in output && typeof output.scannedAllowedPageCount === 'number'
            ? output.scannedAllowedPageCount
            : undefined,
        autoReadPageTitle:
          'autoReadPage' in output && output.autoReadPage && typeof output.autoReadPage === 'object' && 'title' in output.autoReadPage
            ? String(output.autoReadPage.title)
            : undefined,
        keys: Object.keys(output).slice(0, 8)
      };
    }

    return {
      keys: Object.keys(output).slice(0, 8),
      title: 'title' in output ? String(output.title) : undefined,
      textLength: 'text' in output && typeof output.text === 'string' ? output.text.length : undefined
    };
  }

  return { type: typeof output };
}
