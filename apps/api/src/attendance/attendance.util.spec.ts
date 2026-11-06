import { dailySeries } from './attendance.util';

const at = (iso: string) => new Date(iso);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('dailySeries', () => {
  it('turns a complete day into IST clock minutes and net worked minutes', () => {
    // 09:00–18:00 IST (03:30–12:30 UTC) with a 30 minute break
    const [d] = dailySeries([
      {
        date: day('2026-10-05'),
        status: 'PRESENT',
        checkInAt: at('2026-10-05T03:30:00Z'),
        checkOutAt: at('2026-10-05T12:30:00Z'),
        breaks: [{ startAt: at('2026-10-05T07:30:00Z'), endAt: at('2026-10-05T08:00:00Z') }],
      },
    ]);

    expect(d).toEqual({
      date: '2026-10-05',
      status: 'PRESENT',
      checkInMinutes: 9 * 60,
      checkOutMinutes: 18 * 60,
      workedMinutes: 8.5 * 60,
      breakMinutes: 30,
    });
  });

  it('leaves worked time null until the day is checked out', () => {
    const [d] = dailySeries([
      {
        date: day('2026-10-06'),
        status: 'PRESENT',
        checkInAt: at('2026-10-06T03:30:00Z'),
        checkOutAt: null,
        breaks: [{ startAt: at('2026-10-06T07:30:00Z'), endAt: null }],
      },
    ]);

    expect(d.checkInMinutes).toBe(9 * 60);
    expect(d.checkOutMinutes).toBeNull();
    expect(d.workedMinutes).toBeNull();
    expect(d.breakMinutes).toBe(0);
  });

  it('counts a break still open at check-out up to check-out', () => {
    const [d] = dailySeries([
      {
        date: day('2026-10-07'),
        status: 'PRESENT',
        checkInAt: at('2026-10-07T03:30:00Z'),
        checkOutAt: at('2026-10-07T12:30:00Z'),
        breaks: [{ startAt: at('2026-10-07T11:30:00Z'), endAt: null }],
      },
    ]);

    expect(d.breakMinutes).toBe(60);
    expect(d.workedMinutes).toBe(8 * 60);
  });

  it('gives days with no punches null times and zero breaks', () => {
    const [d] = dailySeries([
      { date: day('2026-10-08'), status: 'HOLIDAY', checkInAt: null, checkOutAt: null, breaks: [] },
    ]);

    expect(d).toEqual({
      date: '2026-10-08',
      status: 'HOLIDAY',
      checkInMinutes: null,
      checkOutMinutes: null,
      workedMinutes: null,
      breakMinutes: 0,
    });
  });

  it('sorts oldest first whatever order the records arrive in', () => {
    const rec = (iso: string) => ({
      date: day(iso),
      status: 'ABSENT',
      checkInAt: null,
      checkOutAt: null,
      breaks: [],
    });

    expect(
      dailySeries([rec('2026-10-09'), rec('2026-10-02'), rec('2026-10-05')]).map((d) => d.date),
    ).toEqual(['2026-10-02', '2026-10-05', '2026-10-09']);
  });

  it('wraps a check-in that crosses midnight IST into the right minute of day', () => {
    // 23:45 UTC is 05:15 IST the next calendar day
    const [d] = dailySeries([
      {
        date: day('2026-10-10'),
        status: 'PRESENT',
        checkInAt: at('2026-10-10T23:45:00Z'),
        checkOutAt: null,
        breaks: [],
      },
    ]);

    expect(d.checkInMinutes).toBe(5 * 60 + 15);
  });

  it('never reports negative worked time for out-of-order punches', () => {
    const [d] = dailySeries([
      {
        date: day('2026-10-11'),
        status: 'PRESENT',
        checkInAt: at('2026-10-11T10:00:00Z'),
        checkOutAt: at('2026-10-11T09:00:00Z'),
        breaks: [],
      },
    ]);

    expect(d.workedMinutes).toBe(0);
  });
});
