import { QueryClient, QueryObserver, focusManager, isCancelledError, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphData } from '../types';
import { graphQueryOptions } from './graph';

function isolatedGraph(): GraphData {
  const gid = '9007199254740993';
  return {
    metadata: {
      schema_version: 1, n_nodes: 1, n_edges: 0, n_transactions: 0, n_clusters: 1,
      n_seed: 0, n_boundary: 0, n_isolated: 1, sum_minor: 0,
      date_from: null, date_to: null,
      parameters: { window_days: 3, resolution: 1, random_seed: 42 },
    },
    nodes: [{
      gid, depth: 1, is_seed: false, role: 'peripheral', role_score: 0,
      cluster_id: 0, priority_score: 0, evidence: 'Изолированный клиент',
      role_status: 'observed_pattern', flags: ['partial_observation'],
      in_deg: 0, out_deg: 0, in_kzt: 0, out_kzt: 0, in_tx: 0, out_tx: 0,
      in_minor: 0, out_minor: 0, seed_sources: 0, active_days: 0,
      same_day_activity_days: 0, following_days_out_share: null,
      following_days_matched_minor: 0, window_days: 3, truncated_by_depth: false,
      cycle_component_size: 1, neighbor_clusters: 0, pass_through: null,
    }],
    clusters: [{
      cluster_id: 0, n_nodes: 1, n_seed: 0, sum_kzt_internal: 0,
      top_gids: [gid], hypothesis: 'Нет наблюдаемых связей',
    }],
    edges: [], top_nodes: [], transactions: [], daily_flows: [],
  };
}

describe('graph query', () => {
  let client: QueryClient;
  let wasOnline: boolean;
  let wasFocused: boolean;

  beforeEach(() => {
    wasOnline = onlineManager.isOnline();
    wasFocused = focusManager.isFocused();
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.mount();
  });

  afterEach(() => {
    client.unmount();
    client.clear();
    onlineManager.setOnline(wasOnline);
    focusManager.setFocused(wasFocused);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads a local export even when the browser reports no internet connection', async () => {
    const graph = isolatedGraph();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(graph));
    vi.stubGlobal('fetch', fetchMock);
    onlineManager.setOnline(false);

    const request = client.fetchQuery(graphQueryOptions);
    // Attach a rejection handler before asserting so teardown can safely cancel a paused query.
    void request.catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(graphQueryOptions.queryKey)?.fetchStatus).toBe('fetching');
    await expect(request).resolves.toEqual(graph);
  });

  it.each(['focus', 'reconnect'] as const)('keeps an HTTP failure until manual retry after %s', async (event) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('Missing export', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const observer = new QueryObserver(client, graphQueryOptions);
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('error'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const cache = client.getQueryCache();
      const eventSpy = vi.spyOn(cache, event === 'focus' ? 'onFocus' : 'onOnline');

      if (event === 'focus') {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      } else {
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      }

      await vi.waitFor(() => expect(eventSpy).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(observer.getCurrentResult().status).toBe('error');
    } finally {
      unsubscribe();
      observer.destroy();
    }
  });

  it('exposes an HTTP failure without automatic retries and recovers on manual refetch', async () => {
    const graph = isolatedGraph();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Missing export', { status: 404 }))
      .mockResolvedValueOnce(Response.json(graph));
    vi.stubGlobal('fetch', fetchMock);
    const observer = new QueryObserver(client, graphQueryOptions);

    const failed = await observer.refetch();
    expect(failed.status).toBe('error');
    expect(failed.error?.message).toBe('Не удалось загрузить результаты анализа.');
    expect(failed.data).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const recovered = await observer.refetch();
    expect(recovered.status).toBe('success');
    expect(recovered.error).toBeNull();
    expect(recovered.data).toEqual(graph);
    expect(client.getQueryData(graphQueryOptions.queryKey)).toEqual(graph);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    observer.destroy();
  });

  it('rejects an incompatible export before it reaches the query cache', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(Response.json({ metadata: { schema_version: 2 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.fetchQuery(graphQueryOptions)).rejects.toThrow(/schema_version/);
    expect(client.getQueryState(graphQueryOptions.queryKey)?.status).toBe('error');
    expect(client.getQueryData(graphQueryOptions.queryKey)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the underlying fetch when the query is cancelled', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Request aborted', 'AbortError'));
        }, { once: true });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = client.fetchQuery(graphQueryOptions);
    const cancelled = expect(request).rejects.toSatisfy(isCancelledError);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(fetchMock).toHaveBeenCalledWith('/generated/graph.json', { signal });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    await client.cancelQueries({ queryKey: graphQueryOptions.queryKey });
    await cancelled;
    expect(signal?.aborted).toBe(true);
    expect(client.getQueryState(graphQueryOptions.queryKey)?.fetchStatus).toBe('idle');
    expect(client.getQueryData(graphQueryOptions.queryKey)).toBeUndefined();
  });
});
