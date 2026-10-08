import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SafeHtmlRenderer } from './SafeHtmlRenderer';

const HTML = '<p>Hi</p><img src="https://tracker.example/pixel.gif">';
const frame = () => screen.getByTitle('mgate-email-body') as HTMLIFrameElement;

describe('SafeHtmlRenderer remote images policy', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  it('ask: blocks until the reader clicks, then shows them', async () => {
    render(<SafeHtmlRenderer html={HTML} remoteImages="ask" />);
    expect(frame().srcdoc).not.toContain('tracker.example');
    expect(frame().srcdoc).toContain('img-src data:');
    await userEvent.click(screen.getByRole('button', { name: 'Показать изображения' }));
    expect(frame().srcdoc).toContain('https://tracker.example/pixel.gif');
    expect(frame().srcdoc).toContain('img-src data: https: http:');
    expect(screen.queryByRole('button', { name: 'Показать изображения' })).not.toBeInTheDocument();
  });

  it('always: shows them at once, without a banner', () => {
    render(<SafeHtmlRenderer html={HTML} remoteImages="always" />);
    expect(frame().srcdoc).toContain('https://tracker.example/pixel.gif');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never: blocks them and offers no way to reveal them', () => {
    render(<SafeHtmlRenderer html={HTML} remoteImages="never" />);
    expect(frame().srcdoc).not.toContain('tracker.example');
    expect(screen.queryByRole('button', { name: 'Показать изображения' })).not.toBeInTheDocument();
    expect(screen.getByText(/отключены в настройках/)).toBeInTheDocument();
  });

  it('defaults to asking', () => {
    render(<SafeHtmlRenderer html={HTML} />);
    expect(screen.getByRole('button', { name: 'Показать изображения' })).toBeInTheDocument();
  });

  it('does not carry a reveal over to the next message when keyed by message id', async () => {
    const { rerender } = render(<SafeHtmlRenderer key="a" html={HTML} />);
    await userEvent.click(screen.getByRole('button', { name: 'Показать изображения' }));
    rerender(<SafeHtmlRenderer key="b" html={HTML} />);
    expect(frame().srcdoc).not.toContain('tracker.example');
  });
});
