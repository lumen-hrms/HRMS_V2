import { toCsv } from './report-export';

describe('toCsv', () => {
  const columns = [
    { key: 'department', label: 'Department' },
    { key: 'headcount', label: 'Headcount' },
  ];

  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv({
      columns,
      rows: [{ department: 'R&D, "core"\nteam', headcount: 3 }],
    });
    expect(csv).toBe('Department,Headcount\r\n"R&D, ""core""\nteam",3\r\n');
  });

  it('neutralises spreadsheet formulas in user-typed text', () => {
    const csv = toCsv({
      columns,
      rows: [
        { department: '=HYPERLINK("http://x")', headcount: 1 },
        { department: '+1', headcount: 2 },
      ],
    });
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")",1`);
    expect(csv).toContain(`'+1,2`);
  });

  it('writes empty cells for null values', () => {
    expect(toCsv({ columns, rows: [{ department: null, headcount: null }] })).toBe(
      'Department,Headcount\r\n,\r\n',
    );
  });
});
