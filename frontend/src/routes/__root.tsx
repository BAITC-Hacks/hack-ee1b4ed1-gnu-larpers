import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import stylesheet from '../styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { name: 'theme-color', content: '#234d3c' },
      { title: 'Граф денег · Исследование переводов' },
    ],
    links: [{ rel: 'stylesheet', href: stylesheet }],
  }),
  component: Outlet,
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="app-state">
      <h1>Страница не найдена</h1>
      <a className="export-button" href="/">Вернуться к исследованию</a>
    </div>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
