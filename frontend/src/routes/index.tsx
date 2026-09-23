import { createFileRoute } from '@tanstack/react-router';
import App from '../App';

export const Route = createFileRoute('/')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(search).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  component: App,
});
