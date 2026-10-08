import { describe, expect, it } from 'vitest';
import { isDevVersion, isOlderVersion } from './versionCheck';

describe('isOlderVersion', () => {
  it('compares CalVer YYYY.M.N numerically, not lexically', () => {
    expect(isOlderVersion('2026.9.3', '2026.10.1')).toBe(true);
    expect(isOlderVersion('2026.10.1', '2026.9.3')).toBe(false);
    expect(isOlderVersion('2026.10.1', '2026.10.2')).toBe(true);
    expect(isOlderVersion('2026.10.2', '2026.10.1')).toBe(false);
    expect(isOlderVersion('2025.12.7', '2026.1.1')).toBe(true);
  });

  it('treats equal versions as not older', () => {
    expect(isOlderVersion('2026.10.1', '2026.10.1')).toBe(false);
  });

  it('still handles plain SemVer and missing segments', () => {
    expect(isOlderVersion('1.2.0', '1.10.0')).toBe(true);
    expect(isOlderVersion('1.2', '1.2.0')).toBe(false);
    expect(isOlderVersion('1.2', '1.2.1')).toBe(true);
  });

  it('ignores pre-release/build suffixes and a leading v', () => {
    expect(isOlderVersion('v2026.10.1', '2026.10.2')).toBe(true);
    expect(isOlderVersion('2026.10.1+build5', '2026.10.1')).toBe(false);
  });

  it('never reports dev builds or garbage as outdated', () => {
    expect(isOlderVersion('dev', '2026.10.1')).toBe(false);
    expect(isOlderVersion('0.0.0-dev', '2026.10.1')).toBe(false);
    expect(isOlderVersion('2026.10.1', 'dev')).toBe(false);
    expect(isOlderVersion('abc', '2026.10.1')).toBe(false);
    expect(isOlderVersion('2026.10.1', '')).toBe(false);
  });
});

describe('isDevVersion', () => {
  it('recognizes dev build markers', () => {
    expect(isDevVersion('dev')).toBe(true);
    expect(isDevVersion('0.0.0-dev')).toBe(true);
    expect(isDevVersion('2026.10.1')).toBe(false);
  });
});
