import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { AppLoading } from './AppLoading';

export function getRouter() {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    parseSearch: search => Object.fromEntries(new URLSearchParams(search)),
    stringifySearch: search => {
      const value = new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString();
      return value ? `?${value}` : '';
    },
    context: { queryClient },
    scrollRestoration: true,
    defaultPendingComponent: AppLoading,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
