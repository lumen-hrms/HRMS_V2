import { isWriteToReadOnlyBlocked } from './tenant-resolution.middleware';

describe('isWriteToReadOnlyBlocked (READ_ONLY tenants)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks %s on a normal route', (method) => {
    expect(isWriteToReadOnlyBlocked(method, '/api/leave/requests')).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through', (method) => {
    expect(isWriteToReadOnlyBlocked(method, '/api/employees?page=2')).toBe(false);
  });

  it('lets sign-in through so users can still read their data', () => {
    expect(isWriteToReadOnlyBlocked('POST', '/api/auth/session')).toBe(false);
  });

  it('ignores the query string when matching the exemption', () => {
    expect(isWriteToReadOnlyBlocked('POST', '/api/auth/session?x=1')).toBe(false);
    expect(isWriteToReadOnlyBlocked('POST', '/api/auth/session/extra')).toBe(true);
  });
});
