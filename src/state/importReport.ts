import { createStore } from 'zustand/vanilla';
import type { ImportReport } from '../core/io/ldrawImport/importLDraw';

/** The report on the last LDraw or Studio file opened, as the report dialog shows it. */
export interface ShownImport {
  /** The model's name. */
  readonly name: string;
  readonly report: ImportReport;
  /** Why fewer parts could come in than usual: the parts library is not there. */
  readonly note: string | null;
}

/** The report the dialog shows: the last one shown. */
export const importReportStore = createStore<{ readonly shown: ShownImport | null }>(() => ({ shown: null }));

/** Keeps the report for the dialog to show (opening the dialog is up to the caller). */
export function setImportReport(shown: ShownImport): void {
  importReportStore.setState({ shown });
}

/** The report last shown. */
export function shownImport(): ShownImport | null {
  return importReportStore.getState().shown;
}
