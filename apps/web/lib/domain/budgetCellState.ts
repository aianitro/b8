// Moved to `@b8/contracts/budgetCellState` when the phone needed the same grading.
//
// Re-exported rather than relocated-and-rewired, so the web's existing import paths keep working and
// the move is one file rather than a sweep. The rules themselves are in the shared package because
// two clients now call them; see that file's note.

export {
  monthPct,
  expenseCellState,
  incomeCellState,
  type CellState,
} from '@b8/contracts/budgetCellState';
