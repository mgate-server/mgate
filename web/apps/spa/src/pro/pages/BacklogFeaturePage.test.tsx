import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../../i18n';
import { BacklogFeaturePage } from './BacklogFeaturePage';
import { PRO_FEATURES } from '../features';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/pro/:slug" element={<BacklogFeaturePage />} />
        <Route path="/admin/domains" element={<p>domains-page</p>} />
        <Route path="/admin/settings" element={<p>settings-page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BacklogFeaturePage', () => {
  it.each([
    'dns-autopilot',
    'backup-center',
    'advanced-dashboard',
    'multi-tenant',
    'priority-updates',
  ])('renders an honest "in development" state for %s', async (slug) => {
    await i18n.changeLanguage('ru');
    renderAt(`/admin/pro/${slug}`);
    expect(screen.getByText('Функция в разработке')).toBeInTheDocument();
  });

  it('redirects implemented features to the place where they live', () => {
    renderAt('/admin/pro/dmarc-intelligence');
    expect(screen.getByText('domains-page')).toBeInTheDocument();
  });

  it('marks backup center and advanced dashboard as not implemented (backend answers 501)', () => {
    for (const id of [
      'dns-autopilot',
      'backup-center',
      'advanced-dashboard',
      'multi-tenant-rbac',
      'priority-updates',
    ]) {
      expect(PRO_FEATURES.find((f) => f.id === id)?.implemented).toBeFalsy();
    }
  });

  it('only lists feature flags the backend really defines (no pro.dmarc_intelligence)', () => {
    const backendFlags = [
      'pro.dns_autopilot',
      'pro.advanced_dashboard',
      'pro.backup_center',
      'pro.branding',
      'pro.priority_updates',
      'pro.multi_tenant_rbac',
    ];
    for (const feature of PRO_FEATURES) {
      if (feature.flag !== undefined) expect(backendFlags).toContain(feature.flag);
    }
    const dmarc = PRO_FEATURES.find((f) => f.id === 'dmarc-intelligence');
    expect(dmarc?.flag).toBeUndefined();
    expect(dmarc?.includedWithPro).toBe(true);
  });
});
