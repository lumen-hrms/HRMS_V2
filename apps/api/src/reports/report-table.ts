export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportTable {
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
}
