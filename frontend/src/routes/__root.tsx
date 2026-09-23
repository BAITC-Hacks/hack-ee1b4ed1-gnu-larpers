import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import stylesheet from '../styles.css?url';
import sidebarStylesheet from '../sidebar.css?url';
import flowStylesheet from '../flow.css?url';
import comfortStylesheet from '../comfort.css?url';
import visualizationStylesheet from '../visualization.css?url';
import overviewStylesheet from '../overview.css?url';
import recordsStylesheet from '../records.css?url';
import commandStylesheet from '../command-dialog.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { name: 'theme-color', content: '#0c0b13' },
      { title: 'Анализ транзакций · Аналитический отчёт' },
    ],
    links: [stylesheet, sidebarStylesheet, flowStylesheet, comfortStylesheet, visualizationStylesheet, overviewStylesheet, recordsStylesheet, commandStylesheet]
      .map(href => ({ rel: 'stylesheet', href })),
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
