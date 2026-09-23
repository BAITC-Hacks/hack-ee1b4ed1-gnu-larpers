import { queryOptions } from '@tanstack/react-query';
import { parseGraphData } from '../data';

export const graphQueryOptions = queryOptions({
  queryKey: ['graph'],
  queryFn: async ({ signal }) => {
    const response = await fetch('/generated/graph.json', { signal });
    if (!response.ok) throw new Error('Не удалось загрузить результаты анализа.');
    return parseGraphData(await response.json());
  },
  // The export is a fixed analysis snapshot for the current investigation.
  staleTime: Infinity,
  // Localhost remains available when the browser reports no internet connection.
  networkMode: 'always',
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
});
