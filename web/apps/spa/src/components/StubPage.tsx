import type { ReactNode } from 'react';
import { Card, EmptyState, PageHeader } from '@mgate/ui';

export interface StubPageProps {
  title: string;
  /** What this page is meant to cover and which stage wires it up for real. */
  scope: string;
  todo: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Shared shell for not-yet-implemented pages: states its scope and the TODO(S<n>) that
 * completes it, so every route is a real, navigable page rather than a 404. Pages with real
 * behavior (login, license activation, mail reader, etc.) don't use this and render their own content.
 */
export function StubPage({ title, scope, todo, actions, children }: StubPageProps) {
  return (
    <div>
      <PageHeader title={title} actions={actions} />
      <Card>
        <EmptyState title={scope} description={todo} />
        {children}
      </Card>
    </div>
  );
}
